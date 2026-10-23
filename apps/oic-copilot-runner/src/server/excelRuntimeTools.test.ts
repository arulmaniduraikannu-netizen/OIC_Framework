import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import type { ToolInvocation } from "@github/copilot-sdk";
import { tableFromRows } from "./excelAnalysisRegistry.js";
import { createExcelRuntimeTools, type ExcelRuntimeToolOptions } from "./excelRuntimeTools.js";
import { createDefaultExcelOperationRegistry } from "./excelAnalysisRegistry.js";
import { getExcelOperationCapabilities } from "./excelCapabilities.js";
import type { ExcelOperationResult, ExcelWorkbookSnapshot } from "../shared/types.js";

const snapshot: ExcelWorkbookSnapshot = {
  files: ["invoices.xlsx"],
  tables: [tableFromRows("Invoices", [
    ["Transaction", "Region", "Amount"],
    ["TX-100", "East", "10.50"],
    ["TX-200", "West", "4.50"],
    ["TX-300", "East", "8"]
  ], "invoices.xlsx")],
  profiles: [],
  diagnostics: []
};

const multiTableSnapshot: ExcelWorkbookSnapshot = {
  files: ["east.csv", "west.csv"],
  tables: [
    tableFromRows("east", [
      ["Amount"],
      ["10"],
      [""],
      ["not-a-number"]
    ], "east.csv"),
    tableFromRows("west", [
      ["Amount"],
      ["5"],
      ["8"]
    ], "west.csv")
  ],
  profiles: [],
  diagnostics: []
};

async function invokeTool(name: string, args: unknown, workbookSnapshot = snapshot, toolOptions: ExcelRuntimeToolOptions = {}): Promise<ExcelOperationResult> {
  const tool = createExcelRuntimeTools(workbookSnapshot, toolOptions).find((candidate) => candidate.name === name);
  assert.ok(tool, `Expected ${name} to be registered.`);
  assert.ok(tool.handler, `Expected ${name} to have a handler.`);
  const handler = tool.handler as (handlerArgs: unknown, invocation: ToolInvocation) => Promise<unknown>;
  return await handler(args, {
    sessionId: "test-session",
    toolCallId: "test-tool-call",
    toolName: name,
    arguments: args
  }) as ExcelOperationResult;
}

test("registers focused deterministic Excel tools", () => {
  const tools = createExcelRuntimeTools(snapshot);
  assert.deepEqual(tools.map((tool) => tool.name), [
    "excel_discover",
    "excel_filter",
    "excel_lookup",
    "excel_group",
    "excel_summarize",
    "excel_summarize_multiple",
    "excel_compare",
    "excel_compare_versions",
    "excel_compare_rows",
    "excel_export_xlsx",
    "excel_check_values",
    "excel_validate"
  ]);
  const operationTools = createExcelRuntimeTools(snapshot).map((tool) => tool.name).filter((name) => name !== "excel_export_xlsx");
  const registeredKinds = createDefaultExcelOperationRegistry().getOperationKinds();
  const toolKinds = operationTools.map((name) => name.replace(/^excel_/, "").replace("summarize_multiple", "summarizeMultiple").replace("compare_versions", "compareVersions").replace("compare_rows", "compareRows").replace("check_values", "checkValues")).sort();
  assert.deepEqual(toolKinds, [...registeredKinds].sort());
  assert.deepEqual(getExcelOperationCapabilities().map((capability) => capability.id).slice(0, -1).sort(), [...registeredKinds].sort());
  for (const tool of tools) {
    assert.match(tool.description, /Returns the deterministic tool result.*Do not assume an unreturned presentation schema/i);
  }
});

test("summarize tool returns the registry's deterministic total", async () => {
  const result = await invokeTool("excel_summarize", { table: "Invoices", sumColumn: "Amount" });

  assert.equal(result.kind, "summarize");
  assert.deepEqual(result.facts, { column: "Amount", count: 3, total: 23 });
  assert.deepEqual(result.table?.rows, [{ Column: "Amount", Count: 3, Total: 23 }]);
});

test("multiple-table summarize returns per-table and grand totals with diagnostics", async () => {
  const result = await invokeTool("excel_summarize_multiple", { tables: ["east", "west"], sumColumn: "Amount" }, multiTableSnapshot);

  assert.equal(result.kind, "summarizeMultiple");
  assert.deepEqual(result.facts, { tables: ["east", "west"], count: 3, total: 23 });
  assert.deepEqual(result.table?.rows, [
    { Table: "east", "Source File": "east.csv", Count: 1, Total: 10 },
    { Table: "west", "Source File": "west.csv", Count: 2, Total: 13 },
    { Table: "Grand Total", "Source File": "", Count: 3, Total: 23 }
  ]);
  const nonNumericDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === "NON_NUMERIC_VALUE");
  assert.equal(nonNumericDiagnostics.length, 1);
  assert.equal(nonNumericDiagnostics[0]?.tableName, "east");
  assert.equal(nonNumericDiagnostics[0]?.columnName, "Amount");
});

test("lookup tool preserves exact identifier matching and returns diagnostics", async () => {
  const result = await invokeTool("excel_lookup", {
    table: "Invoices",
    columns: ["Amount"],
    filters: [{ column: "Transaction", value: "TX-999" }]
  });

  assert.deepEqual(result.table?.rows, []);
  assert.equal(result.diagnostics[0]?.code, "NO_MATCHING_ROWS");
});

test("XLSX export is a local runtime capability", async () => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-local-export-"));
  let exportedPath = "";
  try {
    const result = await invokeTool("excel_export_xlsx", { tableName: "Invoices", fileName: "result.xlsx" }, snapshot, {
      outputDirectory,
      onExport: (execution) => { exportedPath = execution.outputPath; }
    }) as unknown as { exported: boolean; outputPath: string };
    assert.equal(result.exported, true);
    assert.equal(result.outputPath, "result.xlsx");
    assert.equal(exportedPath, path.join(outputDirectory, "result.xlsx"));
    await JSZip.loadAsync(await fs.readFile(exportedPath));
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true });
  }
});
