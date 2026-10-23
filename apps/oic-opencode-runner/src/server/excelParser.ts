import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { NormalizedTestCase, SheetSummary, WorkbookSummary } from "../shared/types.js";

type RowRecord = Record<string, string>;
type XmlNode = Record<string, unknown>;

interface WorkbookSheet {
  name: string;
  path: string;
}

const idHeaders = ["test case id", "testcase id", "tc id", "tc#", "id", "test id"];
const titleHeaders = ["title", "scenario", "test case", "testcase", "name", "description"];
const featureHeaders = ["feature", "area", "module", "workload", "component"];
const priorityHeaders = ["priority", "severity", "p0/p1", "rank"];
const preconditionHeaders = ["precondition", "preconditions", "prerequisite", "prerequisites", "setup"];
const stepsHeaders = ["steps", "test steps", "action", "actions", "procedure"];
const expectedHeaders = ["expected", "expected result", "expected results", "result", "validation"];

export async function parseWorkbook(workbookPath: string, workbookId?: string): Promise<WorkbookSummary> {
  const workbook = await readWorkbookXml(workbookPath);
  const sheets: SheetSummary[] = [];
  const testCases: NormalizedTestCase[] = [];

  for (const workbookSheet of workbook.sheets) {
    const rows = toRecords(await parseSheetRows(workbook.zip, workbookSheet.path, workbook.sharedStrings));
    const headers = collectHeaders(rows);

    sheets.push({
      name: workbookSheet.name,
      rowCount: rows.length,
      headers
    });

    testCases.push(...groupRowsIntoCases(rows, workbookPath, workbookSheet.name));
  }

  return { workbookPath, workbookId, sheets, testCases };
}

function groupRowsIntoCases(rows: RowRecord[], workbookPath: string, sheetName: string): NormalizedTestCase[] {
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

async function readWorkbookXml(workbookPath: string): Promise<{ zip: JSZip; sheets: WorkbookSheet[]; sharedStrings: string[] }> {
  const zip = await JSZip.loadAsync(await fs.readFile(workbookPath));
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

async function parseSheetRows(zip: JSZip, sheetPath: string, sharedStrings: string[]): Promise<unknown[][]> {
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    return [];
  }

  const xml = parseXml(await sheetFile.async("text"));
  return asArray(getNode(xml, "worksheet.sheetData.row")).map((row) => rowToValues(row, sharedStrings));
}

function rowToValues(row: XmlNode, sharedStrings: string[]): unknown[] {
  const values: unknown[] = [];
  asArray(row.c).forEach((cell, sequenceIndex) => {
    const columnIndex = getCellColumnIndex(getString(cell, "r")) ?? sequenceIndex;
    values[columnIndex] = getCellValue(cell, sharedStrings);
  });
  return values;
}

function getCellValue(cell: XmlNode, sharedStrings: string[]): string {
  const type = getString(cell, "t");
  if (type === "s") {
    const sharedIndex = Number(getString(cell, "v"));
    return Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "";
  }
  if (type === "inlineStr") {
    return extractText(cell.is as XmlNode);
  }
  if (type === "str") {
    return extractText(cell.v as XmlNode) || getString(cell, "v");
  }
  return getString(cell, "v");
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

function toRecords(rows: unknown[][]): RowRecord[] {
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
