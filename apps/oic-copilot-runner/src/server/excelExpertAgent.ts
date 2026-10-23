import path from "node:path";
import fs from "node:fs/promises";
import JSZip from "jszip";
import type { ExcelAnalysisPlan, ExcelAnalysisResult, ExcelColumnType, ExcelDiagnostic, ExcelExecutionPlan, ExcelPromptPlan, ExcelPromptResponse, ExcelRow, ExcelTable, ExcelTableProfile, ExcelWorkbookSnapshot } from "../shared/types.js";
import { parseCsvContent } from "./transactionAnalysis.js";
import { parseWorkbookTables } from "./excelParser.js";
import { createDefaultExcelOperationRegistry, tableFromRows } from "./excelAnalysisRegistry.js";
import { runExcelMcpFallback, type ExcelMcpFallbackResult, type ExcelMcpInputFile } from "./excelMcpFallback.js";
import { ExcelSessionWaitError, recordExcelValidation, transitionExcelLifecycle } from "./excelSessionTelemetry.js";
import { getExcelCapabilityContracts } from "./excelCapabilities.js";
import { planExcelPrompt } from "./excelPromptPlanner.js";
import type { ExcelCopilotRunOptions } from "./excelCopilotRuntime.js";
import { runExcelAgentRuntime } from "./excelAgentRuntime.js";
import { readUploadedFile, type UploadedFile } from "./uploadedFile.js";
import { writeExcelTable } from "./excelExport.js";
import { persistExcelArtifacts } from "./excelArtifactStore.js";
import { paths } from "./config.js";

const MAX_INPUT_FILES = 20;
const MAX_MCP_ANSWER_LENGTH = 120_000;
const MAX_RESPONSE_ROWS_PER_TABLE = 100;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".zip"]);

export interface EncodedExcelFile {
  fileName: string;
  contentBase64: string;
}

export async function discoverExcelFiles(files: Array<EncodedExcelFile | UploadedFile>): Promise<ExcelWorkbookSnapshot> {
  if (files.length === 0) {
    throw new Error("At least one CSV, XLSX, or ZIP file is required.");
  }

  const tables = [];
  for (const file of files) {
    const content = "filePath" in file ? await readUploadedFile(file) : Buffer.from(file.contentBase64, "base64");
    tables.push(...await adaptExcelFile(file.fileName, content));
    if (tables.length > MAX_INPUT_FILES) {
      throw new Error(`A batch may contain at most ${MAX_INPUT_FILES} tables after ZIP expansion.`);
    }
  }

  return {
    files: tables.map((table) => table.sourceFile ?? table.name),
    tables,
    profiles: tables.map(createTableProfile),
    diagnostics: []
  };
}

function createTableProfile(table: ExcelTable): ExcelTableProfile {
  const columnTypes = Object.fromEntries(table.headers.map((header) => [header, inferColumnType(table.rows.map((row) => row[header]))])) as Record<string, ExcelColumnType>;
  const candidateKeys = table.headers.filter((header) => {
    const values = table.rows.map((row) => String(row[header] ?? "").trim()).filter(Boolean);
    return values.length > 0 && values.length === new Set(values).size;
  });
  return {
    name: table.name,
    sourceFile: table.sourceFile,
    rowCount: table.rows.length,
    headers: table.headers,
    sampleRows: table.rows.slice(0, 3),
    columnTypes,
    candidateKeys
  };
}

function inferColumnType(values: ExcelRow[string][]): ExcelColumnType {
  const nonBlank = values.filter((value) => value !== null && String(value).trim().length > 0);
  if (nonBlank.length === 0) return "blank";
  const types = new Set(nonBlank.map((value) => {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number" || /^[-+]?\d+(?:\.\d+)?$/.test(String(value).trim())) return "number";
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:$|\D)/.test(String(value).trim()) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(value).trim())) return "date";
    return "text";
  }));
  return types.size === 1 ? [...types][0] as ExcelColumnType : "mixed";
}

export async function runExcelAnalysis(files: Array<EncodedExcelFile | UploadedFile>, plan: ExcelAnalysisPlan): Promise<ExcelAnalysisResult> {
  const snapshot = await discoverExcelFiles(files);
  const result = createDefaultExcelOperationRegistry().execute(plan, snapshot.tables);
  return {
    ...result,
    diagnostics: [...snapshot.diagnostics, ...result.diagnostics]
  };
}

async function adaptExcelFile(fileName: string, content: Uint8Array): Promise<ExcelTable[]> {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`${fileName}: only .csv, .xlsx, and .zip files are supported.`);
  }

  if (extension === ".csv") {
    return [tableFromRows(path.basename(fileName, extension), parseCsvContent(Buffer.from(content).toString("utf8")), fileName)];
  }

  if (extension === ".xlsx") {
    const workbookTables = await parseWorkbookTables(content);
    if (workbookTables.length === 0) {
      throw new Error(`${fileName}: workbook contains no worksheets.`);
    }
    return workbookTables.map((table) => tableFromRows(table.name, table.rows, fileName));
  }

  const zip = await JSZip.loadAsync(content);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  if (entries.length === 0) {
    throw new Error(`${fileName}: ZIP contains no .csv or .xlsx files.`);
  }

  const tables = [];
  for (const entry of entries) {
    tables.push(...await adaptExcelFile(`${fileName}#${path.basename(entry.name)}`, await entry.async("uint8array")));
  }
  return tables;
}

export type ExcelPromptPlanner = (snapshot: ExcelWorkbookSnapshot, prompt: string, options?: ExcelCopilotRunOptions) => Promise<ExcelPromptPlan>;
export type ExcelMcpFallback = (files: ExcelMcpInputFile[], prompt: string, options?: ExcelCopilotRunOptions) => Promise<ExcelMcpFallbackResult>;

export async function runExcelPrompt(
  files: Array<EncodedExcelFile | UploadedFile>,
  prompt: string,
  planner: ExcelPromptPlanner = planExcelPrompt,
  mcpFallback: ExcelMcpFallback = runExcelMcpFallback,
  options: ExcelCopilotRunOptions = {},
  runtime: typeof runExcelAgentRuntime = runExcelAgentRuntime
): Promise<ExcelPromptResponse> {
  const incompleteCompareRows = clarificationForIncompleteCompareRows(prompt);
  let snapshot: ExcelWorkbookSnapshot;
  try {
    snapshot = await discoverExcelFiles(files);
  } catch (error) {
    if (planner === planExcelPrompt && isRecoverableExcelExecutionError(error)) {
      return runExcelMcpFallbackForPrompt(files, prompt, `Deterministic Excel discovery failed: ${error instanceof Error ? error.message : String(error)}`, emptyExcelSnapshot(files), mcpFallback, options);
    }
    throw error;
  }
  if (planner === planExcelPrompt) {
    return runtime({ files, prompt, snapshot, options });
  }
  const knownPlan = parseKnownPrompt(prompt, snapshot.tables);
  if (knownPlan) {
    return runKnownLocalPlan(knownPlan, snapshot, prompt);
  }
  if (incompleteCompareRows) {
    return incompleteCompareRows;
  }
  const plan: ExcelPromptPlan = await planner(snapshot, prompt, options);
  if (plan.status === "needsClarification") {
    return plan;
  }
  if (plan.status === "mcp" || plan.status === "unsupported") {
    if (plan.status === "mcp" && plan.capability && !getExcelCapabilityContracts().some((capability) => capability.id === plan.capability)) {
      return { status: "unsupported", reason: `Unknown Excel capability: ${plan.capability}.` };
    }
    return runExcelMcpFallbackForPrompt(files, prompt, plan.reason, snapshot, mcpFallback, options);
  }
  const repairedPlan = repairReadyPlan(plan, prompt, snapshot);
  const compareRowsClarification = clarificationForCompareRowsPlan(repairedPlan);
  if (compareRowsClarification) {
    return compareRowsClarification;
  }
  if (repairedPlan.operations.every((operation) => operation.kind === "discover") && !isExplicitDiscoveryPrompt(prompt)) {
    return {
      status: "needsClarification",
      questions: ["Which record or records should I use, and which field should I return? The proposed plan only discovers workbook structure."]
    };
  }
  const result = createDefaultExcelOperationRegistry().execute(repairedPlan, snapshot.tables);
  const clarification = clarificationForDiagnostics(result.diagnostics, repairedPlan.explanation);
  if (clarification) {
    return clarification;
  }
  return {
    status: "completed",
    analysis: compactAnalysisResult(result, snapshot.diagnostics),
    explanation: repairedPlan.explanation
  };
}

export function autonomousRuntimeFailureResponse(error: unknown): Extract<ExcelPromptResponse, { status: "unsupported" }> {
  return {
    status: "unsupported",
    reason: `Autonomous Excel execution failed without starting a second MCP session: ${error instanceof Error ? error.message : String(error)}`
  };
}

function isRecoverableExcelExecutionError(error: unknown): boolean {
  return error instanceof Error && /invalid string length/i.test(error.message);
}

function emptyExcelSnapshot(files: Array<EncodedExcelFile | UploadedFile>): ExcelWorkbookSnapshot {
  return { files: files.map((file) => file.fileName), tables: [], profiles: [], diagnostics: [] };
}

function compactAnalysisResult(result: ExcelAnalysisResult, snapshotDiagnostics: ExcelDiagnostic[]): ExcelAnalysisResult {
  const finalOperation = result.operations.at(-1);
  return {
    tables: finalOperation?.table ? [compactExcelTable(finalOperation.table)] : [],
    operations: result.operations.map((operation) => ({
      ...operation,
      ...(operation.table ? { table: compactExcelTable(operation.table) } : {})
    })),
    diagnostics: [...snapshotDiagnostics, ...result.diagnostics]
  };
}

function compactExcelTable(table: ExcelTable): ExcelTable {
  return { ...table, rows: table.rows.slice(0, MAX_RESPONSE_ROWS_PER_TABLE) };
}

function clarificationForIncompleteCompareRows(prompt: string): ExcelPromptResponse | undefined {
  if (!/\bcompare\b/i.test(prompt) || !/\b(?:2|two)\s+rows?\b/i.test(prompt) || !/\ball\s+columns?\b/i.test(prompt)) {
    return undefined;
  }
  if (/\brows?\s*\d+\s*(?:and|vs\.?|versus|with)\s*(?:row\s*)?\d+\b/i.test(prompt)) {
    return undefined;
  }
  return {
    status: "needsClarification",
    questions: ["Which two Excel row numbers should I compare? For example: row 2 and row 3."]
  };
}

function clarificationForCompareRowsPlan(plan: Extract<ExcelPromptPlan, { status: "ready" }>): ExcelPromptResponse | undefined {
  const hasIncompleteCompareRows = plan.operations.some((operation) => {
    if (operation.kind !== "compareRows") {
      return false;
    }
    return !isExcelRowNumber(operation.options.firstRow) || !isExcelRowNumber(operation.options.secondRow);
  });
  if (!hasIncompleteCompareRows) {
    return undefined;
  }
  return {
    status: "needsClarification",
    questions: ["Which two Excel row numbers should I compare? For example: row 2 and row 3."]
  };
}

function isExcelRowNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2;
}

function repairReadyPlan(plan: Extract<ExcelPromptPlan, { status: "ready" }>, prompt: string, snapshot: ExcelWorkbookSnapshot): Extract<ExcelPromptPlan, { status: "ready" }> {
  const operations = plan.operations.map((operation) => {
    if (operation.kind === "compareRows" && typeof operation.options.rightTable === "string") {
      const leftTable = snapshot.tables.find((table) => table.name === operation.inputTable);
      const rightTable = snapshot.tables.find((table) => table.name === operation.options.rightTable);
      const sharedHeaders = leftTable?.headers.filter((header) => rightTable?.headers.includes(header)) ?? [];
      const key = typeof operation.options.key === "string" ? operation.options.key : chooseComparisonKey(leftTable, rightTable, sharedHeaders, prompt);
      if (leftTable && rightTable && key) {
        const columns = Array.isArray(operation.options.columns) && operation.options.columns.length > 0
          ? operation.options.columns.filter((column): column is string => typeof column === "string")
          : sharedHeaders.filter((header) => header !== key);
        return {
          ...operation,
          kind: "compare" as const,
          options: { rightTable: rightTable.name, key, columns }
        };
      }
    }
    if (operation.kind === "compareRows" && typeof operation.options.oldTable === "string" && typeof operation.options.newTable === "string") {
      const oldTable = snapshot.tables.find((table) => table.name === operation.options.oldTable);
      const newTable = snapshot.tables.find((table) => table.name === operation.options.newTable);
      const sharedHeaders = oldTable?.headers.filter((header) => newTable?.headers.includes(header)) ?? [];
      const key = typeof operation.options.key === "string" ? operation.options.key : chooseComparisonKey(oldTable, newTable, sharedHeaders, prompt);
      if (oldTable && newTable && key) {
        return {
          ...operation,
          kind: "compareVersions" as const,
          inputTable: undefined,
          options: { oldTable: oldTable.name, newTable: newTable.name, key, columns: sharedHeaders.filter((header) => header !== key) }
        };
      }
    }
    if (operation.kind !== "group" || typeof operation.options.sumColumn === "string") {
      return operation;
    }
    const table = snapshot.tables.find((candidate) => candidate.name === (operation.inputTable ?? snapshot.tables[0]?.name));
    if (!table) {
      return operation;
    }
    const sumColumn = findPromptColumnAfter(prompt, table.headers, /\b(?:sum|total)\b/i);
    if (!sumColumn || snapshot.profiles.find((profile) => profile.name === table.name)?.columnTypes[sumColumn] !== "number") {
      return operation;
    }
    return { ...operation, options: { ...operation.options, sumColumn } };
  });

  if (operations.every((operation, index) => operation === plan.operations[index])) {
    return plan;
  }
  const repairedPlan = { ...plan, operations };
  return { ...repairedPlan, executionPlan: buildExecutionPlan(repairedPlan) };
}

function chooseComparisonKey(left: ExcelTable | undefined, right: ExcelTable | undefined, sharedHeaders: string[], prompt: string): string | undefined {
  const mentioned = findPromptKey(prompt, sharedHeaders);
  if (mentioned) return mentioned;
  return sharedHeaders.find((header) => /\b(?:id|key|number|code|transaction|order|invoice)\b/i.test(header)
    && isUnique(left, header) && isUnique(right, header))
    ?? sharedHeaders.find((header) => isUnique(left, header) && isUnique(right, header));
}

function isUnique(table: ExcelTable | undefined, column: string): boolean {
  if (!table) return false;
  const values = table.rows.map((row) => String(row[column] ?? "").trim()).filter(Boolean);
  return values.length > 0 && values.length === new Set(values).size;
}

async function runExcelMcpFallbackForPrompt(
  files: Array<EncodedExcelFile | UploadedFile>,
  prompt: string,
  limitationReason: string,
  snapshot: ExcelWorkbookSnapshot,
  mcpFallback: ExcelMcpFallback,
  options: ExcelCopilotRunOptions
): Promise<ExcelPromptResponse> {
  try {
    const result = await mcpFallback(files, `${prompt.trim()}\n\nLocal analysis limitation: ${limitationReason}`, options);
    validateMcpFallbackResult(result, snapshot);
    if (result.telemetry) {
      recordExcelValidation(result.telemetry, true, [
        "MCP source files matched uploaded workbook inputs",
        "MCP table and column provenance checked",
        "MCP tool provenance checked"
      ]);
      transitionExcelLifecycle(result.telemetry, "completed", "validated MCP result accepted");
    }
    return {
      status: "mcpCompleted",
      answer: compactMcpAnswer(result.answer),
      source: "mbeps/excel-mcp",
      files: result.files,
      artifacts: result.artifacts ?? [],
      toolsUsed: result.toolsUsed,
      provenance: result.provenance,
      localVerification: "not-performed",
      ...(result.telemetry ? { telemetry: result.telemetry } : {}),
      ...(result.copilot ? { copilot: result.copilot } : {})
    };
  } catch (error) {
    return {
      status: "unsupported",
      reason: `Local analysis could not represent this request, and the Excel MCP fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      ...(error instanceof ExcelSessionWaitError ? { telemetry: error.telemetry } : {})
    };
  }
}

function compactMcpAnswer(answer: string): string {
  if (answer.length <= MAX_MCP_ANSWER_LENGTH) {
    return answer;
  }
  return `${answer.slice(0, MAX_MCP_ANSWER_LENGTH)}\n\n[The MCP response was truncated to keep the result transportable.]`;
}

function validateMcpFallbackResult(result: ExcelMcpFallbackResult, snapshot: ExcelWorkbookSnapshot): void {
  if (!result.answer.trim()) {
    throw new Error("Excel MCP returned an empty answer.");
  }
  if (result.files.length === 0 || result.files.some((file) => !file.trim())) {
    throw new Error("Excel MCP did not report the source file used for its answer.");
  }
  if (result.toolsUsed.length === 0 || result.toolsUsed.some((tool) => !tool.trim())) {
    throw new Error("Excel MCP did not report tool provenance.");
  }
  if (!result.provenance || result.provenance.sourceFiles.length === 0 || result.provenance.sourceFiles.some((file) => !file.trim())) {
    throw new Error("Excel MCP did not report structured source provenance.");
  }
  if (result.provenance.sourceFiles.length !== result.files.length || result.provenance.sourceFiles.some((file) => !result.files.includes(file))) {
    throw new Error("Excel MCP source provenance does not match its reported files.");
  }

  const uploadedFileNames = new Set(snapshot.tables.map((table) => fileNameForMcpResult(table.sourceFile ?? table.name)));
  const unknownFile = result.files.find((file) => !uploadedFileNames.has(fileNameForMcpResult(file)));
  if (unknownFile) {
    throw new Error(`Excel MCP reported a file that was not uploaded: ${unknownFile}.`);
  }
  for (const tableReference of result.provenance.tables) {
    if (!uploadedFileNames.has(fileNameForMcpResult(tableReference.sourceFile))) {
      throw new Error(`Excel MCP reported a table from a file that was not uploaded: ${tableReference.sourceFile}.`);
    }
    const matchingTable = snapshot.tables.find((table) =>
      fileNameForMcpResult(table.sourceFile ?? table.name) === fileNameForMcpResult(tableReference.sourceFile)
      && table.name === tableReference.tableName
    );
    if (!matchingTable) {
      throw new Error(`Excel MCP reported an unknown table: ${tableReference.tableName}.`);
    }
    const unknownColumn = tableReference.columns.find((column) => !matchingTable.headers.includes(column));
    if (unknownColumn) {
      throw new Error(`Excel MCP reported an unknown column: ${unknownColumn}.`);
    }
  }
}

function fileNameForMcpResult(fileName: string): string {
  const memberName = fileName.split("#").at(-1) ?? fileName;
  const baseName = memberName.replaceAll("\\", "/").split("/").at(-1) ?? memberName;
  const withoutStagingPrefix = baseName.replace(/^\d{3}-/, "");
  return withoutStagingPrefix.replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
}

function clarificationForDiagnostics(diagnostics: ExcelDiagnostic[], explanation?: string): ExcelPromptResponse | undefined {
  const rowNotFound = diagnostics.find((diagnostic) => diagnostic.code === "ROW_NOT_FOUND");
  if (rowNotFound) {
    return {
      status: "needsClarification",
      questions: [`${rowNotFound.message} Please confirm the exact identifier before I compare the requested fields.`],
      explanation
    };
  }
  const multipleRows = diagnostics.find((diagnostic) => diagnostic.code === "MULTIPLE_ROWS_FOUND");
  if (multipleRows) {
    return {
      status: "needsClarification",
      questions: [`${multipleRows.message} Please provide a more specific identifier or confirm that all matching rows should be checked.`],
      explanation
    };
  }
  return undefined;
}

function isExplicitDiscoveryPrompt(prompt: string): boolean {
  return /\b(?:discover|list|show|inspect|what|which|how many)\b.{0,60}\b(?:workbook|files?|sheets?|tables?|headers?|columns?|structure|row counts?)\b/i.test(prompt);
}

function parseKnownPrompt(prompt: string, tables: ExcelTable[]): ExcelAnalysisPlan | undefined {
  const normalized = prompt.trim();
  const versionPlan = parseVersionComparisonPrompt(normalized, tables);
  if (versionPlan) {
    return versionPlan;
  }
  const tableName = tables.length === 1 ? tables[0].name : tables.find((table) => mentionsTable(normalized, table.name))?.name;
  if (!tableName) {
    return undefined;
  }
  const table = tables.find((candidate) => candidate.name === tableName) as ExcelTable;
  const checks = parsePromptChecks(normalized, table.headers);
  if (checks.length >= 2 && /\b(?:check|verify|validate|confirm|match)\b/i.test(normalized)) {
    const selector = checks.find((check) => /\b(?:trx|transaction|invoice|id|number)\b/i.test(check.column)) ?? checks[0];
    return {
      operations: [{
        id: "prompt-analysis",
        kind: "checkValues",
        inputTable: tableName,
        options: { matchColumn: selector.column, matchValue: selector.value, checks: checks.map((check) => ({ column: check.column, expected: check.value })) }
      }]
    };
  }
  const rowMatch = normalized.match(/\brows?\s*(\d+)\s*(?:and|vs\.?|versus|with)\s*(?:row\s*)?(\d+)\b/i);
  if (rowMatch) {
    return { operations: [{ id: "prompt-analysis", kind: "compareRows", inputTable: tableName, options: { firstRow: Number(rowMatch[1]), secondRow: Number(rowMatch[2]) } }] };
  }
  if (/\b(?:sum|total)\b/i.test(normalized) && /\bcount\b/i.test(normalized)) {
    const sumColumn = findPromptColumn(normalized, table.headers);
    if (!sumColumn) {
      return undefined;
    }
    return { operations: [{ id: "prompt-analysis", kind: "summarize", inputTable: tableName, options: { sumColumn } }] };
  }
  return undefined;
}

function parseVersionComparisonPrompt(prompt: string, tables: ExcelTable[]): ExcelAnalysisPlan | undefined {
  if (tables.length < 2 || !/\b(?:compare|comparison|reconcile|diff|difference|changed|added|deleted)\b/i.test(prompt)) {
    return undefined;
  }
  if (!/\b(?:old|previous|prior|baseline|before|new|current|latest|updated|after)\b/i.test(prompt)) {
    return undefined;
  }
  const oldTable = chooseVersionTable(tables, /\b(?:old|previous|prior|baseline|before)\b/i, 0);
  const newTable = chooseVersionTable(tables, /\b(?:new|current|latest|updated|after)\b/i, 1, oldTable.name);
  const sharedHeaders = oldTable.headers.filter((header) => newTable.headers.includes(header));
  const key = findPromptKey(prompt, sharedHeaders);
  if (!key) {
    return undefined;
  }
  const mentionedColumns = sharedHeaders.filter((header) => prompt.toLowerCase().includes(header.toLowerCase()) && header !== key);
  return {
    operations: [{
      id: "prompt-version-comparison",
      kind: "compareVersions",
      options: {
        oldTable: oldTable.name,
        newTable: newTable.name,
        key,
        columns: mentionedColumns.length > 0 ? mentionedColumns : sharedHeaders.filter((header) => header !== key)
      }
    }]
  };
}

function chooseVersionTable(tables: ExcelTable[], marker: RegExp, fallbackIndex: number, excludedName?: string): ExcelTable {
  const candidates = tables.filter((table) => table.name !== excludedName);
  return candidates.find((table) => marker.test(`${table.name} ${table.sourceFile ?? ""}`))
    ?? candidates[fallbackIndex]
    ?? candidates[0]
    ?? tables[0];
}

function findPromptKey(prompt: string, headers: string[]): string | undefined {
  const keyPhrase = prompt.match(/\b(?:by|using|on)\s+([^,.;]+?)(?:\s+(?:and|show|with|for)\b|[,.;]|$)/i)?.[1] ?? "";
  return headers.find((header) => keyPhrase.toLowerCase().includes(header.toLowerCase()))
    ?? headers.find((header) => /\b(?:id|key|number|code)\b/i.test(header) && prompt.toLowerCase().includes(header.toLowerCase()));
}

function findPromptColumn(prompt: string, headers: string[]): string | undefined {
  const normalizedPrompt = prompt.toLowerCase();
  return headers.find((header) => normalizedPrompt.includes(header.toLowerCase()))
    ?? headers.find((header) => header.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every((word) => normalizedPrompt.includes(word)));
}

function findPromptColumnAfter(prompt: string, headers: string[], marker: RegExp): string | undefined {
  const match = marker.exec(prompt);
  if (!match) {
    return undefined;
  }
  const suffix = prompt.slice(match.index + match[0].length).toLowerCase();
  return headers
    .map((header) => ({ header, index: suffix.indexOf(header.toLowerCase()) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index)[0]?.header;
}

function parsePromptChecks(prompt: string, headers: string[]): Array<{ column: string; value: string }> {
  const headerPattern = headers
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((header) => escapeRegExp(header))
    .join("|");
  if (!headerPattern) {
    return [];
  }
  const markerPattern = new RegExp(`(?:^|[\\s,;])(${headerPattern})\\s*:`, "gi");
  const markers: Array<{ column: string; start: number; valueStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(prompt)) !== null) {
    const column = headers.find((header) => header.toLowerCase() === match?.[1]?.toLowerCase());
    if (column) {
      markers.push({ column, start: match.index, valueStart: markerPattern.lastIndex });
    }
  }
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.start ?? prompt.length;
    return { column: marker.column, value: prompt.slice(marker.valueStart, end).replace(/^[\\s,;]+|[\\s.;]+$/g, "").trim() };
  }).filter((check) => check.value.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

function mentionsTable(prompt: string, tableName: string): boolean {
  const escapedName = escapeRegExp(tableName.trim());
  return escapedName.length > 0 && new RegExp(`(?:^|\\s)${escapedName}(?:$|\\s|[,.;])`, "i").test(prompt);
}

function buildExecutionPlan(plan: Extract<ExcelPromptPlan, { status: "ready" }>): ExcelExecutionPlan {
  return {
    steps: [
      ...plan.operations.map((operation) => ({ id: operation.id, capability: "local-registry" as const, operation })),
      ...(plan.export ? [{ id: "export-xlsx", capability: "local-registry" as const, export: plan.export }] : [])
    ]
  };
}

async function runKnownLocalPlan(plan: ExcelAnalysisPlan, snapshot: ExcelWorkbookSnapshot, prompt: string): Promise<ExcelPromptResponse> {
  const result = createDefaultExcelOperationRegistry().execute(plan, snapshot.tables);
  const clarification = clarificationForDiagnostics(result.diagnostics, undefined);
  if (clarification) {
    return clarification;
  }

  const finalTable = result.operations.at(-1)?.table;
  if (!finalTable) {
    return { status: "completed", analysis: { ...result, diagnostics: [...snapshot.diagnostics, ...result.diagnostics] } };
  }
  if (!isExcelExportPrompt(prompt)) {
    return { status: "completed", analysis: compactAnalysisResult(result, snapshot.diagnostics) };
  }

  await fs.mkdir(paths.runtimeDataPath, { recursive: true });
  const stagingDirectory = await fs.mkdtemp(path.join(paths.runtimeDataPath, "excel-local-"));
  try {
    await writeExcelTable(stagingDirectory, finalTable, "row-comparison.xlsx");
    const artifacts = await persistExcelArtifacts(stagingDirectory, [], { comparisonOnly: true });
    return { status: "completed", analysis: compactAnalysisResult(result, snapshot.diagnostics), artifacts };
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
}

function isExplicitRowComparisonPrompt(prompt: string): boolean {
  return /\brows?\s*\d+\s*(?:and|vs\.?|versus|with)\s*(?:row\s*)?\d+\b/i.test(prompt)
    && /\bcompare\b/i.test(prompt);
}

function isExcelExportPrompt(prompt: string): boolean {
  return /\b(?:export|download|save|excel\s+sheet|xlsx)\b/i.test(prompt);
}