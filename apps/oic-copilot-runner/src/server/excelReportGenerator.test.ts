import assert from "node:assert/strict";
import test from "node:test";
import { createExcelAnalysisReport } from "./excelReportGenerator.js";

test("creates deterministic Markdown and CSV reports from analysis facts", () => {
  const report = createExcelAnalysisReport({
    tables: [],
    diagnostics: [],
    operations: [{
      operationId: "grouped-sales",
      kind: "group",
      facts: { groupCount: 1 },
      diagnostics: [],
      table: { name: "sales_grouped", headers: ["Region", "Count"], rows: [{ Region: "East", Count: 2 }] }
    }]
  }, "sales report");

  assert.equal(report.fileName, "sales-report.md");
  assert.match(report.markdown, /\| East \| 2 \|/);
  assert.match(report.csv, /"table","grouped-sales","group","sales_grouped"/);
});