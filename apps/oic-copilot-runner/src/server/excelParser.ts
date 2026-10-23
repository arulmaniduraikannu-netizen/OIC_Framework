import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { ExcelValue, NormalizedTestCase, SheetSummary, WorkbookSummary } from "../shared/types.js";

type RowRecord = Record<string, string>;
type XmlNode = Record<string, unknown>;

interface WorkbookSheet {
  name: string;
  path: string;
}

export interface WorkbookTable {
  name: string;
  rows: ExcelValue[][];
}

export function excelValueText(value: ExcelValue): string {
  if (value.kind === "date") return value.value.toISOString().slice(0, 10);
  if (value.kind === "datetime") return value.value.toISOString().replace(/\.000Z$/, "Z");
  return String(value.value ?? "").trim();
}

interface WorkbookStyles { customFormats: Map<number, string>; cellFormats: number[] }

const idHeaders = ["test case id", "testcase id", "tc id", "tc#", "id", "test id"];
const titleHeaders = ["title", "scenario", "test case", "testcase", "name", "description"];
const featureHeaders = ["feature", "area", "module", "workload", "component"];
const priorityHeaders = ["priority", "severity", "p0/p1", "rank"];
const preconditionHeaders = ["precondition", "preconditions", "prerequisite", "prerequisites", "setup"];
const stepsHeaders = ["steps", "test steps", "action", "actions", "procedure"];
const expectedHeaders = ["expected", "expected result", "expected results", "result", "validation"];
const scenarioHeaders = ["test case scenario", "scenario"];

export async function parseWorkbook(workbookPath: string, workbookId?: string): Promise<WorkbookSummary> {
  const tables = await parseWorkbookTables(await fs.readFile(workbookPath));
  const sheets: SheetSummary[] = [];
  const testCases: NormalizedTestCase[] = [];

  for (const table of tables) {
    const rows = toRecords(table.rows);
    const headers = collectHeaders(rows);

    sheets.push({
      name: table.name,
      rowCount: rows.length,
      headers
    });

    testCases.push(...groupRowsIntoCases(rows, workbookPath, table.name));
  }

  return { workbookPath, workbookId, sheets, testCases };
}

export async function parseWorkbookTables(content: Uint8Array): Promise<WorkbookTable[]> {
  const workbook = await readWorkbookXml(content);
  const styles = await readWorkbookStyles(workbook.zip);
  return Promise.all(workbook.sheets.map(async (workbookSheet) => ({
    name: workbookSheet.name,
    rows: await parseSheetRows(workbook.zip, workbookSheet.path, workbook.sharedStrings, styles)
  })));
}

/**
 * Groups rows into test cases. Azure DevOps test exports put the test case on a
 * `Work Item Type = "Test Case"` row followed by unlabelled step rows whose
 * `Step Action` holds each step. We attach those steps to the case above them so
 * the model receives the full instructions (not a title-only case with the steps
 * scattered into separate fake cases). Sheets without a Work Item Type column keep
 * the one-row-per-case behaviour.
 */
function groupRowsIntoCases(rows: RowRecord[], workbookPath: string, sheetName: string): NormalizedTestCase[] {
  if (looksLikeScenarioWorkbook(rows)) {
    return groupScenarioRowsIntoCases(rows, workbookPath, sheetName);
  }

  const hasWorkItemType = rows.some((row) => pick(normalizeRecord(row), ["work item type"]).length > 0);

  if (!hasWorkItemType) {
    return rows
      .map((row, index) => normalizeRow(row, workbookPath, sheetName, index + 2))
      .filter((testCase): testCase is NormalizedTestCase => Boolean(testCase));
  }

  const cases: NormalizedTestCase[] = [];
  let current: NormalizedTestCase | undefined;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const raw = normalizeRecord(row);
    const workItemType = pick(raw, ["work item type"]);

    if (/test case/i.test(workItemType)) {
      const normalized = normalizeRow(row, workbookPath, sheetName, rowNumber);
      if (normalized) {
        normalized.steps = [];
        current = normalized;
        cases.push(normalized);
      }
      return;
    }

    if (!current) {
      return;
    }

    const stepAction = pick(raw, ["step action", "action"]) || pick(raw, stepsHeaders);
    const stepExpected = pick(raw, ["step expected"]) || pick(raw, expectedHeaders);
    const cleanedAction = stepAction.replace(/\s+/g, " ").trim();
    if (cleanedAction && !/^\d+(\.\d+)?$/.test(cleanedAction)) {
      current.steps.push(cleanedAction);
    }
    const cleanedExpected = stepExpected.replace(/\s+/g, " ").trim();
    if (cleanedExpected) {
      current.expectedResult = current.expectedResult
        ? `${current.expectedResult}\n${cleanedExpected}`
        : cleanedExpected;
    }
  });

  return cases;
}

function looksLikeScenarioWorkbook(rows: RowRecord[]): boolean {
  let sawScenario = false;
  let sawContinuationRow = false;

  rows.forEach((row) => {
    const raw = normalizeRecord(row);
    const scenario = pick(raw, scenarioHeaders);
    const steps = pick(raw, stepsHeaders);
    if (scenario) {
      sawScenario = true;
      return;
    }
    if (steps) {
      sawContinuationRow = true;
    }
  });

  return sawScenario && sawContinuationRow;
}

/**
 * Some manually-authored Excel sheets store the scenario title once, then keep
 * the rest of the steps on following rows with a blank scenario column. Group
 * those continuation rows under the last non-empty scenario so the UI exposes
 * one runnable case per scenario instead of one runnable case per step.
 */
function groupScenarioRowsIntoCases(rows: RowRecord[], workbookPath: string, sheetName: string): NormalizedTestCase[] {
  const cases: NormalizedTestCase[] = [];
  let current: NormalizedTestCase | undefined;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const raw = normalizeRecord(row);
    const scenario = pick(raw, scenarioHeaders);

    if (scenario) {
      const normalized = normalizeRow(row, workbookPath, sheetName, rowNumber);
      if (normalized) {
        current = normalized;
        cases.push(normalized);
      }
      return;
    }

    if (!current) {
      return;
    }

    const stepText = pick(raw, stepsHeaders).replace(/\s+/g, " ").trim();
    if (stepText) {
      current.steps.push(stepText);
    }

    const expectedText = pick(raw, expectedHeaders).replace(/\s+/g, " ").trim();
    if (expectedText) {
      current.expectedResult = current.expectedResult
        ? `${current.expectedResult}\n${expectedText}`
        : expectedText;
    }

    const preconditionsText = pick(raw, preconditionHeaders).replace(/\s+/g, " ").trim();
    if (preconditionsText && !current.preconditions) {
      current.preconditions = preconditionsText;
    }
  });

  return cases;
}

async function readWorkbookXml(content: Uint8Array): Promise<{ zip: JSZip; sheets: WorkbookSheet[]; sharedStrings: string[] }> {
  const zip = await JSZip.loadAsync(content);
  const workbookXml = await readXml(zip, "xl/workbook.xml");
  const relationshipsXml = await readXml(zip, "xl/_rels/workbook.xml.rels");
  const sharedStrings = await readSharedStrings(zip);
  const relationships = new Map<string, string>();

  asArray(getNode(relationshipsXml, "Relationships.Relationship")).forEach((relationship) => {
    const id = getString(relationship, "Id");
    const target = getString(relationship, "Target");
    if (id && target) {
      relationships.set(id, resolveWorkbookPart(target));
    }
  });

  const sheets = asArray(getNode(workbookXml, "workbook.sheets.sheet"))
    .map((sheet) => {
      const relationshipId = getString(sheet, "r:id") || getString(sheet, "id");
      const target = relationshipId ? relationships.get(relationshipId) : undefined;
      return target ? { name: getString(sheet, "name") || target, path: target } : undefined;
    })
    .filter((sheet): sheet is WorkbookSheet => Boolean(sheet));

  return { zip, sheets, sharedStrings };
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  if (!zip.file("xl/sharedStrings.xml")) {
    return [];
  }

  const xml = await readXml(zip, "xl/sharedStrings.xml");
  return asArray(getNode(xml, "sst.si")).map((item) => extractText(item));
}

async function parseSheetRows(zip: JSZip, sheetPath: string, sharedStrings: string[], styles: WorkbookStyles): Promise<ExcelValue[][]> {
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    return [];
  }

  const xml = parseXml(await sheetFile.async("text"));
  return asArray(getNode(xml, "worksheet.sheetData.row")).map((row) => rowToValues(row, sharedStrings, styles));
}

function rowToValues(row: XmlNode, sharedStrings: string[], styles: WorkbookStyles): ExcelValue[] {
  const values: ExcelValue[] = [];
  asArray(row.c).forEach((cell, sequenceIndex) => {
    const columnIndex = getCellColumnIndex(getString(cell, "r")) ?? sequenceIndex;
    values[columnIndex] = getCellValue(cell, sharedStrings, styles);
  });
  return values;
}

function getCellValue(cell: XmlNode, sharedStrings: string[], styles: WorkbookStyles): ExcelValue {
  const type = getString(cell, "t");
  if (type === "s") {
    const sharedIndex = Number(getString(cell, "v"));
    return { kind: "string", value: Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "" };
  }
  if (type === "inlineStr") {
    return { kind: "string", value: extractText(cell.is as XmlNode) };
  }
  if (type === "str") {
    return { kind: "string", value: extractText(cell.v as XmlNode) || getString(cell, "v") };
  }
  if (type === "b") return { kind: "boolean", value: getString(cell, "v") === "1" };
  const raw = getString(cell, "v");
  if (!raw) return { kind: "blank", value: null };
  if (type && type !== "n") return { kind: "string", value: raw };
  const number = Number(raw);
  if (!Number.isFinite(number)) return { kind: "string", value: raw };
  const styleIndex = Number(getString(cell, "s") || 0);
  const format = styles.cellFormats[styleIndex] === undefined ? undefined : styles.customFormats.get(styles.cellFormats[styleIndex]) ?? builtInDateFormats.get(styles.cellFormats[styleIndex]);
  const dateKind = classifyDateFormat(format);
  if (!dateKind) return { kind: "number", value: number };
  return { kind: dateKind, value: excelSerialToDate(number), ...(format ? { format } : {}) };
}

const builtInDateFormats = new Map<number, string>([[14, "mm-dd-yy"], [15, "d-mmm-yy"], [16, "d-mmm"], [17, "mmm-yy"], [18, "h:mm AM/PM"], [19, "h:mm:ss AM/PM"], [20, "h:mm"], [21, "h:mm:ss"], [22, "m/d/yy h:mm"], [45, "mm:ss"], [46, "[h]:mm:ss"], [47, "mmss.0"]]);

async function readWorkbookStyles(zip: JSZip): Promise<WorkbookStyles> {
  const xml = await readXml(zip, "xl/styles.xml");
  const customFormats = new Map<number, string>();
  asArray(getNode(xml, "styleSheet.numFmts.numFmt")).forEach((format) => {
    const id = Number(getString(format, "numFmtId"));
    const code = getString(format, "formatCode");
    if (Number.isFinite(id) && code) customFormats.set(id, code);
  });
  const cellFormats = asArray(getNode(xml, "styleSheet.cellXfs.xf")).map((format) => Number(getString(format, "numFmtId") || 0));
  return { customFormats, cellFormats };
}

function classifyDateFormat(format?: string): "date" | "datetime" | undefined {
  if (!format) return undefined;
  const cleaned = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "").toLowerCase();
  const hasDate = /[yd]/.test(cleaned) || /m/.test(cleaned);
  const hasTime = /[hs]/.test(cleaned) || /am\/pm/.test(cleaned);
  return hasDate ? (hasTime ? "datetime" : "date") : hasTime ? "datetime" : undefined;
}

function excelSerialToDate(serial: number): Date {
  const adjusted = serial >= 60 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + Math.round(adjusted * 86_400_000));
}

function getCellColumnIndex(reference: string): number | undefined {
  const match = reference.match(/^([A-Z]+)/i);
  if (!match) {
    return undefined;
  }

  return [...match[1].toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

async function readXml(zip: JSZip, filePath: string): Promise<XmlNode> {
  const file = zip.file(filePath);
  if (!file) {
    return {};
  }
  return parseXml(await file.async("text"));
}

function parseXml(xml: string): XmlNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    textNodeName: "#text",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false
  });
  return parser.parse(xml) as XmlNode;
}

function resolveWorkbookPart(target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  return path.posix.normalize(`xl/${target}`);
}

function asArray(value: unknown): XmlNode[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? (value as XmlNode[]) : [value as XmlNode];
}

function getNode(root: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as XmlNode)[segment];
  }, root);
}

function getString(root: unknown, key: string): string {
  if (root === null || root === undefined) {
    return "";
  }
  if (typeof root === "string" || typeof root === "number" || typeof root === "boolean") {
    return String(root).trim();
  }
  if (typeof root !== "object") {
    return "";
  }
  const value = (root as XmlNode)[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).join("");
  }
  if (typeof value === "object") {
    const node = value as XmlNode;
    return [node["#text"], node.t, node.r].map((item) => extractText(item)).join("");
  }
  return "";
}

function toRecords(rows: ExcelValue[][]): RowRecord[] {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map((cell, index) => formatCell(cell) || `Column ${index + 1}`);
  return dataRows
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, formatCell(row[index])])) as RowRecord)
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0));
}

function formatCell(value: unknown): string {
  if (value && typeof value === "object" && "kind" in value && "value" in value) return excelValueText(value as ExcelValue);
  if (value && typeof value === "object" && "kind" in value && "value" in value) {
    const typed = value as ExcelValue;
    if (typed.kind === "date") return typed.value.toISOString().slice(0, 10);
    if (typed.kind === "datetime") return typed.value.toISOString().replace(/\.000Z$/, "Z");
    return String(typed.value ?? "").trim();
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value) {
      return formatCell(value.result);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => formatCell(item)).join("").trim();
    }
  }
  return String(value ?? "").trim();
}

function normalizeRow(row: RowRecord, workbookPath: string, sheetName: string, rowNumber: number): NormalizedTestCase | undefined {
  const raw = normalizeRecord(row);
  const id = pick(raw, idHeaders) || inferId(raw, rowNumber);
  const title = pick(raw, titleHeaders) || firstMeaningfulValue(raw) || `Excel row ${rowNumber}`;
  const stepsText = pick(raw, stepsHeaders);
  const expectedResult = pick(raw, expectedHeaders);

  if (!hasAutomationSignal(id, title, stepsText, expectedResult)) {
    return undefined;
  }

  return {
    id,
    title,
    feature: pick(raw, featureHeaders) || sheetName,
    priority: pick(raw, priorityHeaders) || "Unspecified",
    preconditions: pick(raw, preconditionHeaders),
    steps: splitSteps(stepsText || title),
    expectedResult,
    sourceWorkbook: path.basename(workbookPath),
    sheetName,
    rowNumber,
    raw
  };
}

function normalizeRecord(row: RowRecord): RowRecord {
  return Object.fromEntries(
    Object.entries(row)
      .map(([key, value]) => [key.trim(), String(value ?? "").trim()])
      .filter(([key]) => key.length > 0)
  );
}

function collectHeaders(rows: RowRecord[]): string[] {
  const headers = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => headers.add(key.trim())));
  return [...headers].filter(Boolean);
}

function pick(row: RowRecord, candidates: string[]): string {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const match = entries.find(([key]) => normalizeHeader(key) === candidate);
    if (match?.[1]) {
      return match[1];
    }
  }

  for (const candidate of candidates) {
    const match = entries.find(([key]) => normalizeHeader(key).includes(candidate));
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]+/g, " ").replace(/[:#]/g, "").trim();
}

function inferId(row: RowRecord, rowNumber: number): string {
  const text = Object.values(row).join(" ");
  const match = text.match(/TC#?\s*\d+/i) || text.match(/\b\d{6,}\b/);
  return match ? match[0].replace(/\s+/g, "") : `ROW-${rowNumber}`;
}

function firstMeaningfulValue(row: RowRecord): string {
  return Object.values(row).find((value) => value.length > 8) || "";
}

function splitSteps(value: string): string[] {
  return value
    .split(/(?:\r?\n|\s+\d+[.)]\s+|\s+[;|]\s+)/)
    .map((step) => step.trim())
    .filter(Boolean);
}

function hasAutomationSignal(id: string, title: string, steps: string, expected: string): boolean {
  const combined = `${id} ${title} ${steps} ${expected}`.toLowerCase();
  return combined.includes("oracle") || combined.includes("oic") || combined.includes("fusion") || combined.includes("incentive") || combined.includes("jobset") || combined.includes("transaction") || combined.includes("commission") || combined.includes("compensation") || /^tc#?\d+/i.test(id) || /^row-\d+$/i.test(id);
}
