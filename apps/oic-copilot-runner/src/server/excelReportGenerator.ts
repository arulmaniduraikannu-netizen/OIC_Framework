import type { ExcelAnalysisReport, ExcelAnalysisResult, ExcelCell, ExcelTable } from "../shared/types.js";

export function createExcelAnalysisReport(analysis: ExcelAnalysisResult, fileName = "excel-analysis-report"): ExcelAnalysisReport {
  const safeName = fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "excel-analysis-report";
  const markdown = [
    "# Excel Analysis Report",
    "",
    `Generated tables: ${analysis.tables.length}`,
    `Operations: ${analysis.operations.length}`,
    `Diagnostics: ${analysis.diagnostics.length}`,
    "",
    "## Diagnostics",
    "",
    analysis.diagnostics.length === 0 ? "No diagnostics." : analysis.diagnostics.map((diagnostic) => `- **${diagnostic.severity}** ${diagnostic.code}: ${diagnostic.message}`).join("\n"),
    "",
    ...analysis.operations.flatMap((operation) => [
      `## ${operation.operationId}`,
      "",
      `Operation: ${operation.kind}`,
      `Facts: ${JSON.stringify(operation.facts)}`,
      "",
      operation.table ? markdownTable(operation.table) : "No output table.",
      ""
    ])
  ].join("\n");

  return { fileName: `${safeName}.md`, markdown, csv: csvReport(analysis) };
}

function markdownTable(table: ExcelTable): string {
  const header = `| ${table.headers.map(escapeMarkdown).join(" | ")} |`;
  const divider = `| ${table.headers.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) => `| ${table.headers.map((headerName) => escapeMarkdown(row[headerName])).join(" | ")} |`);
  return [`### ${table.name}`, "", header, divider, ...rows].join("\n");
}

function csvReport(analysis: ExcelAnalysisResult): string {
  const lines = ["section,operationId,kind,table,headers,row"]; 
  analysis.operations.forEach((operation) => {
    if (!operation.table) {
      lines.push(csvRow(["operation", operation.operationId, operation.kind, "", "", JSON.stringify(operation.facts)]));
      return;
    }
    operation.table.rows.forEach((row) => {
      lines.push(csvRow(["table", operation.operationId, operation.kind, operation.table?.name ?? "", operation.table?.headers.join(" | ") ?? "", JSON.stringify(row)]));
    });
  });
  analysis.diagnostics.forEach((diagnostic) => {
    lines.push(csvRow(["diagnostic", "", diagnostic.code, diagnostic.tableName ?? "", diagnostic.columnName ?? "", diagnostic.message]));
  });
  return `${lines.join("\n")}\n`;
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",");
}

function escapeMarkdown(value: ExcelCell): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}