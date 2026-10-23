import { defineTool } from "@github/copilot-sdk";
import path from "node:path";
import { z } from "zod";
import { createDefaultExcelOperationRegistry } from "./excelAnalysisRegistry.js";
import { EXCEL_XLSX_EXPORT_CAPABILITY } from "./excelCapabilities.js";
import { writeExcelTable } from "./excelExport.js";
import type { ExcelOperationKind, ExcelOperationResult, ExcelTable, ExcelWorkbookSnapshot } from "../shared/types.js";

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const namedTableSchema = z.string().trim().min(1);
const outputNameSchema = namedTableSchema.optional();
const LOCAL_RESULT_CONTRACT = "Returns the deterministic tool result. For analysis, use exact table headers and rows, available facts, and diagnostics; for export, use the reported artifact status and output name. Do not assume an unreturned presentation schema.";

export interface ExcelRuntimeToolExecution {
  kind: ExcelOperationKind;
  inputTable?: string;
  options: Record<string, unknown>;
  result: ExcelOperationResult;
  tables: ExcelTable[];
}

export interface ExcelRuntimeExportExecution {
  tableName: string;
  fileName?: string;
  outputPath: string;
}

export interface ExcelRuntimeToolOptions {
  onExecution?: (execution: ExcelRuntimeToolExecution) => void;
  onExport?: (execution: ExcelRuntimeExportExecution) => void;
  outputDirectory?: string;
}

export function createExcelRuntimeTools(snapshot: ExcelWorkbookSnapshot, toolOptions: ExcelRuntimeToolOptions = {}) {
  let workingTables = [...snapshot.tables];
  const registry = createDefaultExcelOperationRegistry();
  const execute = (kind: ExcelOperationKind, inputTable: string | undefined, options: Record<string, unknown>): ExcelOperationResult => {
    const analysis = registry.execute({
      operations: [{ id: `runtime-${kind}`, kind, ...(inputTable ? { inputTable } : {}), options }]
    }, workingTables);
    workingTables = analysis.tables;
    const result = analysis.operations[0];
    toolOptions.onExecution?.({ kind, inputTable, options, result, tables: analysis.tables });
    return result;
  };

  return [
    defineTool("excel_discover", {
      description: "Return deterministic workbook table names, row counts, and source files.",
      parameters: z.object({}),
      skipPermission: true,
      defer: "never",
      handler: async () => execute("discover", undefined, {})
    }),
    defineTool("excel_filter", {
      description: "Filter an exact workbook table by a named column and value.",
      parameters: z.object({
        table: namedTableSchema,
        column: namedTableSchema,
        value: cellSchema,
        mode: z.enum(["equals", "contains"]).optional(),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, column, value, mode, outputName }) => execute("filter", table, { column, value, ...(mode ? { mode } : {}), ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_lookup", {
      description: "Return explicitly requested columns for rows matching named filters in an exact workbook table.",
      parameters: z.object({
        table: namedTableSchema,
        columns: z.array(namedTableSchema).min(1),
        filters: z.array(z.object({
          column: namedTableSchema,
          value: cellSchema,
          mode: z.enum(["equals", "contains"]).optional()
        })).optional(),
        allRows: z.boolean().optional(),
        limit: z.number().int().min(1).max(10_000).optional(),
        outputName: outputNameSchema
      }).refine((value) => value.allRows === true || (value.filters?.length ?? 0) > 0, {
        message: "Provide at least one filter or set allRows to true."
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, columns, filters, allRows, limit, outputName }) => execute("lookup", table, {
        columns,
        ...(filters ? { filters } : {}),
        ...(allRows !== undefined ? { allRows } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(outputName ? { outputName } : {})
      })
    }),
    defineTool("excel_group", {
      description: "Group an exact workbook table by a named column and optionally sum a named numeric column.",
      parameters: z.object({
        table: namedTableSchema,
        groupBy: namedTableSchema,
        sumColumn: namedTableSchema.optional(),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, groupBy, sumColumn, outputName }) => execute("group", table, { groupBy, ...(sumColumn ? { sumColumn } : {}), ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_summarize", {
      description: "Deterministically count and sum an exact numeric column in one workbook table. This tool accepts one table only.",
      parameters: z.object({
        table: namedTableSchema,
        sumColumn: namedTableSchema,
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, sumColumn, outputName }) => execute("summarize", table, { sumColumn, ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_summarize_multiple", {
      description: "Deterministically count and sum the same numeric column across multiple exact workbook tables. Use this for cross-file or cross-table totals; do not pass an array to excel_summarize.",
      parameters: z.object({
        tables: z.array(namedTableSchema).min(1),
        sumColumn: namedTableSchema,
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ tables, sumColumn, outputName }) => execute("summarizeMultiple", undefined, { tables, sumColumn, ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_compare", {
      description: "Compare two exact tables by a named key and explicitly named columns.",
      parameters: z.object({
        table: namedTableSchema,
        rightTable: namedTableSchema,
        key: namedTableSchema,
        columns: z.array(namedTableSchema),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, rightTable, key, columns, outputName }) => execute("compare", table, { rightTable, key, columns, ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_compare_versions", {
      description: "Compare old and new workbook tables by a named key, reporting added, deleted, changed, and unchanged rows.",
      parameters: z.object({
        oldTable: namedTableSchema,
        newTable: namedTableSchema,
        key: namedTableSchema,
        columns: z.array(namedTableSchema).optional(),
        includeUnchanged: z.boolean().optional(),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ oldTable, newTable, key, columns, includeUnchanged, outputName }) => execute("compareVersions", undefined, {
        oldTable,
        newTable,
        key,
        ...(columns ? { columns } : {}),
        ...(includeUnchanged !== undefined ? { includeUnchanged } : {}),
        ...(outputName ? { outputName } : {})
      })
    }),
    defineTool("excel_compare_rows", {
      description: "Compare two explicit Excel row numbers across every column in an exact table.",
      parameters: z.object({
        table: namedTableSchema,
        firstRow: z.number().int().min(2),
        secondRow: z.number().int().min(2),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, firstRow, secondRow, outputName }) => execute("compareRows", table, { firstRow, secondRow, ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_export_xlsx", {
      description: `${EXCEL_XLSX_EXPORT_CAPABILITY.description} Call this after the requested analysis operation.`,
      parameters: z.object({ tableName: namedTableSchema, fileName: z.string().trim().min(1).max(120).optional() }),
      skipPermission: true,
      defer: "never",
      handler: async ({ tableName, fileName }) => {
        if (!toolOptions.outputDirectory) throw new Error("XLSX export output is not configured.");
        const table = workingTables.find((candidate) => candidate.name === tableName);
        if (!table) throw new Error(`Cannot export unknown result table ${tableName}.`);
        const outputPath = await writeExcelTable(toolOptions.outputDirectory, table, fileName);
        toolOptions.onExport?.({ tableName, ...(fileName ? { fileName } : {}), outputPath });
        return { exported: true, tableName, outputPath: path.basename(outputPath) };
      }
    }),
    defineTool("excel_check_values", {
      description: "Check explicitly requested values after uniquely matching an exact row by a named column and value.",
      parameters: z.object({
        table: namedTableSchema,
        matchColumn: namedTableSchema,
        matchValue: cellSchema,
        checks: z.array(z.object({ column: namedTableSchema, expected: cellSchema })).min(1),
        outputName: outputNameSchema
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, matchColumn, matchValue, checks, outputName }) => execute("checkValues", table, { matchColumn, matchValue, checks, ...(outputName ? { outputName } : {}) })
    }),
    defineTool("excel_validate", {
      description: "Validate required, unique, non-blank, numeric, date, and allowed-value constraints for an exact table.",
      parameters: z.object({
        table: namedTableSchema,
        requiredColumns: z.array(namedTableSchema).optional(),
        uniqueColumn: namedTableSchema.optional(),
        nonBlankColumns: z.array(namedTableSchema).optional(),
        numericColumns: z.array(namedTableSchema).optional(),
        dateColumns: z.array(namedTableSchema).optional(),
        allowedValues: z.record(namedTableSchema, z.array(namedTableSchema).min(1)).optional()
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ table, requiredColumns, uniqueColumn, nonBlankColumns, numericColumns, dateColumns, allowedValues }) => execute("validate", table, {
        ...(requiredColumns ? { requiredColumns } : {}),
        ...(uniqueColumn ? { uniqueColumn } : {}),
        ...(nonBlankColumns ? { nonBlankColumns } : {}),
        ...(numericColumns ? { numericColumns } : {}),
        ...(dateColumns ? { dateColumns } : {}),
        ...(allowedValues ? { allowedValues } : {})
      })
    })
  ].map((tool) => ({
    ...tool,
    description: `${tool.description} ${LOCAL_RESULT_CONTRACT}`
  }));
}
