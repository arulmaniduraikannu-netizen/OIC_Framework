import type {
  ExcelAnalysisPlan,
  ExcelAnalysisResult,
  ExcelCell,
  ExcelValue,
  ExcelDiagnostic,
  ExcelOperationKind,
  ExcelOperationCapability,
  ExcelOperationResult,
  ExcelOperationSpec,
  ExcelRow,
  ExcelTable
} from "../shared/types.js";

export interface ExcelOperationContext {
  tables: ExcelTable[];
}

export interface ExcelOperation {
  kind: ExcelOperationKind;
  capability: ExcelOperationCapability;
  execute(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult;
}

export class ExcelOperationRegistry {
  private readonly operations = new Map<ExcelOperationKind, ExcelOperation>();

  register(operation: ExcelOperation): this {
    if (operation.capability.id !== operation.kind) {
      throw new Error(`Capability id ${operation.capability.id} does not match registered operation ${operation.kind}.`);
    }
    if (this.operations.has(operation.kind)) {
      throw new Error(`Excel operation ${operation.kind} is already registered.`);
    }
    this.operations.set(operation.kind, operation);
    return this;
  }

  getOperationKinds(): ExcelOperationKind[] {
    return [...this.operations.keys()];
  }

  getCapabilities(): ExcelOperationCapability[] {
    return [...this.operations.values()].map((operation) => ({
      ...operation.capability,
      requiredInputs: [...operation.capability.requiredInputs],
      optionalInputs: [...operation.capability.optionalInputs],
      ...(operation.capability.operators ? { operators: [...operation.capability.operators] } : {}),
      ...(operation.capability.aggregations ? { aggregations: [...operation.capability.aggregations] } : {}),
      ...(operation.capability.valueTypes ? { valueTypes: [...operation.capability.valueTypes] } : {}),
      limitations: [...operation.capability.limitations]
    }));
  }

  execute(plan: ExcelAnalysisPlan, tables: ExcelTable[]): ExcelAnalysisResult {
    const workingTables = [...tables];
    const results = plan.operations.map((spec) => {
      const operation = this.operations.get(spec.kind);
      if (!operation) {
        return failedOperation(spec, `Unsupported Excel operation: ${spec.kind}.`);
      }
      try {
        const result = operation.execute(spec, { tables: workingTables });
        if (result.table) {
          workingTables.push(result.table);
        }
        return result;
      } catch (error) {
        return failedOperation(spec, error instanceof Error ? error.message : String(error));
      }
    });

    return {
      tables: workingTables,
      operations: results,
      diagnostics: results.flatMap((result) => result.diagnostics)
    };
  }
}

export function createDefaultExcelOperationRegistry(): ExcelOperationRegistry {
  return new ExcelOperationRegistry()
    .register({ kind: "discover", capability: capability("discover", "List discovered tables, row counts, and names.", [], [], "multiple", "metadata", ["Does not return cell values."]), execute: discoverOperation })
    .register({ kind: "filter", capability: capability("filter", "Return rows matching one named column and value.", ["table", "column", "value"], ["mode", "outputName"], "one", "table-and-facts", ["Case-insensitive equals or contains only."], ["equals", "contains"], ["string", "number", "boolean", "date", "datetime"]), execute: filterOperation })
    .register({ kind: "lookup", capability: capability("lookup", "Return selected columns from rows matching AND-combined filters.", ["table", "columns"], ["filters", "allRows", "limit", "outputName"], "one", "table-and-facts", ["At least one filter is required unless allRows is true.", "Maximum 10,000 returned rows; default 1,000."], ["equals", "contains"], ["string", "number", "boolean", "date", "datetime"], undefined, "boundedRows"), execute: lookupOperation })
    .register({ kind: "group", capability: capability("group", "Group one table and return row counts, with an optional numeric sum.", ["table", "groupBy"], ["sumColumn", "outputName"], "one", "table-and-facts", ["Only count and sum are supported; sum ignores non-numeric values with diagnostics."], undefined, ["number"], ["count", "sum"]), execute: groupOperation })
    .register({ kind: "summarize", capability: capability("summarize", "Count numeric values and calculate their total for one column.", ["table", "sumColumn"], ["outputName"], "one", "table-and-facts", ["Only count and sum are supported; non-numeric values are skipped with diagnostics."], undefined, ["number"], ["count", "sum"]), execute: summarizeOperation })
    .register({ kind: "summarizeMultiple", capability: capability("summarizeMultiple", "Count numeric values and calculate per-table and grand totals across selected tables.", ["tables", "sumColumn"], ["outputName"], "multiple", "table-and-facts", ["Uses the same named numeric column in every selected table; only count and sum are supported."], undefined, ["number"], ["count", "sum"]), execute: summarizeMultipleOperation })
    .register({ kind: "compare", capability: capability("compare", "Join two tables by a key and compare selected columns.", ["table", "rightTable", "key", "columns"], ["outputName"], "two", "table-and-facts", ["Reports left-side rows as MATCH, MISMATCH, or MISSING; duplicate right keys are not diagnosed."], ["normalized equality"], ["string", "number", "boolean", "date", "datetime"]), execute: compareOperation })
    .register({ kind: "compareVersions", capability: capability("compareVersions", "Compare old and new table versions by key and report added, deleted, changed, and optionally unchanged rows.", ["oldTable", "newTable", "key"], ["columns", "includeUnchanged", "outputName"], "two", "table-and-facts", ["Duplicate and blank keys are diagnosed; omitted columns means all shared non-key columns."], ["normalized equality"], ["string", "number", "boolean", "date", "datetime"]), execute: compareVersionsOperation })
    .register({ kind: "compareRows", capability: capability("compareRows", "Compare two explicit Excel row numbers across every column of one table.", ["table", "firstRow", "secondRow"], ["outputName"], "one", "table-and-facts", ["Row numbers refer to worksheet row numbers; headers are row 1."], ["normalized equality"], ["string", "number", "boolean", "date", "datetime"], undefined, "selectedRows"), execute: compareRowsOperation })
    .register({ kind: "checkValues", capability: capability("checkValues", "Match exactly one row by a named value and check explicitly selected expected fields.", ["table", "matchColumn", "matchValue", "checks"], ["outputName"], "one", "table-and-facts", ["Requires exactly one matching row; zero or multiple matches produce diagnostics."], ["normalized equality"], ["string", "number", "boolean", "date", "datetime"], undefined, "selectedRows"), execute: checkValuesOperation })
    .register({ kind: "validate", capability: capability("validate", "Check required columns and row-level uniqueness, blank, numeric, date, and allowed-value constraints.", ["table"], ["requiredColumns", "uniqueColumn", "nonBlankColumns", "numericColumns", "dateColumns", "allowedValues"], "one", "diagnostics", ["No repair or coercion is performed."], undefined, ["string", "number", "boolean", "date", "datetime"]), execute: validateOperation });
}

function capability(
  id: ExcelOperationKind,
  description: string,
  requiredInputs: string[],
  optionalInputs: string[],
  tableScope: ExcelOperationCapability["tableScope"],
  resultType: ExcelOperationCapability["resultType"],
  limitations: string[],
  operators?: string[],
  valueTypes?: ExcelOperationCapability["valueTypes"],
  aggregations?: string[],
  rowScope: ExcelOperationCapability["rowScope"] = "allRows"
): ExcelOperationCapability {
  return { id, description, requiredInputs, optionalInputs, tableScope, rowScope, resultType, createsArtifact: false, limitations, ...(operators ? { operators } : {}), ...(valueTypes ? { valueTypes } : {}), ...(aggregations ? { aggregations } : {}) };
}

export function tableFromRows(name: string, rows: Array<Array<string | ExcelValue>>, sourceFile?: string): ExcelTable {
  const headerValues = rows[0] ?? [];
  const headers = uniqueHeaders(headerValues.map((value, index) => cellText(value).trim() || `Column ${index + 1}`));
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cellText(cell).trim().length > 0));
  return {
    name,
    headers,
    sourceFile,
    rows: dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] === undefined ? "" : normalizeInputCell(row[index])])) as ExcelRow)
  };
}

function cellText(value: string | ExcelValue): string {
  if (typeof value === "string") return value;
  if (value.kind === "date") return value.value.toISOString().slice(0, 10);
  if (value.kind === "datetime") return value.value.toISOString();
  return String(value.value ?? "");
}

function normalizeInputCell(value: string | ExcelValue): ExcelCell {
  if (typeof value === "string") return value.trim();
  if (value.kind === "blank") return null;
  if (value.kind === "date" || value.kind === "datetime") return value;
  return value.value;
}

function discoverOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  return {
    operationId: spec.id,
    kind: spec.kind,
    facts: {
      tableCount: context.tables.length,
      tableNames: context.tables.map((table) => table.name),
      rowCounts: context.tables.map((table) => `${table.name}: ${table.rows.length}`)
    },
    diagnostics: []
  };
}

function filterOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const column = requiredString(spec.options.column, "filter column");
  const mode = spec.options.mode === "contains" ? "contains" : "equals";
  const expected = requiredString(spec.options.value, "filter value");
  requireColumn(table, column);
  const normalizedExpected = normalizeValue(expected);
  const rows = table.rows.filter((row) => {
    const actual = normalizeValue(row[column]);
    return mode === "contains" ? actual.includes(normalizedExpected) : actual === normalizedExpected;
  });
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { ...table, name: outputName(spec, `${table.name}_filtered`), rows },
    facts: { inputRows: table.rows.length, outputRows: rows.length },
    diagnostics: []
  };
}

function lookupOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const columns = stringOptions(spec.options.columns);
  if (columns.length === 0) {
    throw new Error("At least one lookup output column is required.");
  }
  columns.forEach((column) => requireColumn(table, column));

  const rawFilters = spec.options.filters ?? [];
  if (!Array.isArray(rawFilters)) {
    throw new Error("Lookup filters must be an array.");
  }
  const filters = rawFilters.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Lookup filter ${index + 1} must specify a column and value.`);
    }
    const filter = value as { column?: unknown; value?: unknown; mode?: unknown };
    const column = requiredString(filter.column, `lookup filter ${index + 1} column`);
    if (!("value" in filter)) {
      throw new Error(`Lookup filter ${index + 1} must specify a value.`);
    }
    const mode = filter.mode === undefined || filter.mode === "equals" ? "equals" : filter.mode === "contains" ? "contains" : undefined;
    if (!mode) {
      throw new Error(`Lookup filter ${index + 1} mode must be equals or contains.`);
    }
    requireColumn(table, column);
    return { column, value: filter.value as ExcelCell, mode };
  });

  if (spec.options.allRows !== undefined && typeof spec.options.allRows !== "boolean") {
    throw new Error("allRows must be a boolean.");
  }
  if (filters.length === 0 && spec.options.allRows !== true) {
    throw new Error("Provide at least one lookup filter or set allRows to true explicitly.");
  }

  const limit = spec.options.limit === undefined ? 1000 : spec.options.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new Error("Lookup limit must be an integer from 1 to 10000.");
  }

  const matchedRows = table.rows.filter((row) => filters.every((filter) => {
    if (filter.mode === "contains") {
      return String(row[filter.column] ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    }
    return valuesMatch(row[filter.column], filter.value);
  }));
  const rows = matchedRows.slice(0, limit).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])) as ExcelRow);
  const diagnostics: ExcelDiagnostic[] = [];
  if (matchedRows.length === 0) {
    diagnostics.push({ severity: "info", code: "NO_MATCHING_ROWS", message: "No rows matched the lookup filters.", tableName: table.name });
  }
  if (matchedRows.length > rows.length) {
    diagnostics.push({ severity: "warning", code: "RESULT_LIMIT_APPLIED", message: `Showing ${rows.length} of ${matchedRows.length} matching rows. Increase the lookup limit to return more rows.`, tableName: table.name });
  }

  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${table.name}_lookup`), headers: columns, rows },
    facts: { inputRows: table.rows.length, matchedRows: matchedRows.length, returnedRows: rows.length, truncated: matchedRows.length > rows.length },
    diagnostics
  };
}

function groupOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const groupBy = requiredString(spec.options.groupBy, "groupBy column");
  const sumColumn = typeof spec.options.sumColumn === "string" ? spec.options.sumColumn : undefined;
  requireColumn(table, groupBy);
  if (sumColumn) {
    requireColumn(table, sumColumn);
  }

  const groups = new Map<string, { count: number; total: number }>();
  const diagnostics: ExcelDiagnostic[] = [];
  table.rows.forEach((row, index) => {
    const key = normalizeValue(row[groupBy]) || "(blank)";
    const group = groups.get(key) ?? { count: 0, total: 0 };
    group.count += 1;
    if (sumColumn) {
      const number = numericValue(row[sumColumn]);
      if (number === undefined) {
        diagnostics.push({ severity: "warning", code: "NON_NUMERIC_VALUE", message: `Value in ${sumColumn} is not numeric.`, tableName: table.name, rowNumber: index + 2, columnName: sumColumn });
      } else {
        group.total += number;
      }
    }
    groups.set(key, group);
  });

  const headers = sumColumn ? [groupBy, "Count", `Sum of ${sumColumn}`] : [groupBy, "Count"];
  const rows = [...groups.entries()].map(([key, group]) => ({
    [groupBy]: key,
    Count: group.count,
    ...(sumColumn ? { [`Sum of ${sumColumn}`]: group.total } : {})
  }));
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${table.name}_grouped`), headers, rows },
    facts: { groupCount: rows.length, inputRows: table.rows.length },
    diagnostics
  };
}

function compareOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const left = inputTable(spec, context);
  const rightName = requiredString(spec.options.rightTable, "rightTable");
  const right = findTable(context, rightName);
  const key = requiredString(spec.options.key, "comparison key");
  const columns = Array.isArray(spec.options.columns) ? spec.options.columns.filter((value): value is string => typeof value === "string") : [];
  requireColumn(left, key);
  requireColumn(right, key);
  columns.forEach((column) => {
    requireColumn(left, column);
    requireColumn(right, column);
  });

  const rightByKey = new Map(right.rows.map((row) => [normalizeValue(row[key]), row]));
  const rows = left.rows.map((leftRow) => {
    const keyValue = normalizeValue(leftRow[key]);
    const rightRow = rightByKey.get(keyValue);
    const matches = Boolean(rightRow) && columns.every((column) => normalizeValue(leftRow[column]) === normalizeValue(rightRow?.[column] ?? null));
    return { [key]: keyValue, Status: rightRow ? (matches ? "MATCH" : "MISMATCH") : "MISSING", ...Object.fromEntries(columns.map((column) => [`${column} (left)`, leftRow[column], `${column} (right)`, rightRow?.[column] ?? ""])) };
  });
  const matched = rows.filter((row) => row.Status === "MATCH").length;
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${left.name}_compared_to_${right.name}`), headers: Object.keys(rows[0] ?? { [key]: "", Status: "" }), rows },
    facts: { matched, mismatched: rows.filter((row) => row.Status === "MISMATCH").length, missing: rows.filter((row) => row.Status === "MISSING").length },
    diagnostics: []
  };
}

function validateOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const requiredColumns = Array.isArray(spec.options.requiredColumns) ? spec.options.requiredColumns.filter((value): value is string => typeof value === "string") : [];
  const uniqueColumn = typeof spec.options.uniqueColumn === "string" ? spec.options.uniqueColumn : undefined;
  const nonBlankColumns = stringOptions(spec.options.nonBlankColumns);
  const numericColumns = stringOptions(spec.options.numericColumns);
  const dateColumns = stringOptions(spec.options.dateColumns);
  const allowedValues = recordOfStringArrays(spec.options.allowedValues);
  const diagnostics: ExcelDiagnostic[] = [];
  requiredColumns.forEach((column) => {
    if (!table.headers.includes(column)) {
      diagnostics.push({ severity: "error", code: "MISSING_COLUMN", message: `Required column ${column} was not found.`, tableName: table.name, columnName: column });
    }
  });
  [...nonBlankColumns, ...numericColumns, ...dateColumns, ...Object.keys(allowedValues)].forEach((column) => {
    if (!table.headers.includes(column)) {
      diagnostics.push({ severity: "error", code: "MISSING_COLUMN", message: `Validation column ${column} was not found.`, tableName: table.name, columnName: column });
    }
  });
  if (uniqueColumn && table.headers.includes(uniqueColumn)) {
    const seen = new Set<string>();
    table.rows.forEach((row, index) => {
      const value = normalizeValue(row[uniqueColumn]);
      if (value && seen.has(value)) {
        diagnostics.push({ severity: "error", code: "DUPLICATE_VALUE", message: `Duplicate value in ${uniqueColumn}: ${value}.`, tableName: table.name, rowNumber: index + 2, columnName: uniqueColumn });
      }
      seen.add(value);
    });
  }
  table.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    nonBlankColumns.forEach((column) => {
      if (table.headers.includes(column) && normalizeValue(row[column]) === "") {
        diagnostics.push({ severity: "error", code: "BLANK_VALUE", message: `${column} must not be blank.`, tableName: table.name, rowNumber, columnName: column });
      }
    });
    numericColumns.forEach((column) => {
      if (table.headers.includes(column) && normalizeValue(row[column]) !== "" && numericValue(row[column]) === undefined) {
        diagnostics.push({ severity: "error", code: "NON_NUMERIC_VALUE", message: `Value in ${column} is not numeric.`, tableName: table.name, rowNumber, columnName: column });
      }
    });
    dateColumns.forEach((column) => {
      if (table.headers.includes(column) && normalizeValue(row[column]) !== "" && !isDateValue(row[column])) {
        diagnostics.push({ severity: "error", code: "INVALID_DATE", message: `Value in ${column} is not a valid date.`, tableName: table.name, rowNumber, columnName: column });
      }
    });
    Object.entries(allowedValues).forEach(([column, values]) => {
      if (table.headers.includes(column) && !values.some((value) => normalizeValue(value) === normalizeValue(row[column]))) {
        diagnostics.push({ severity: "error", code: "VALUE_NOT_ALLOWED", message: `Value in ${column} is not one of: ${values.join(", ")}.`, tableName: table.name, rowNumber, columnName: column });
      }
    });
  });
  return { operationId: spec.id, kind: spec.kind, facts: { valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"), issueCount: diagnostics.length }, diagnostics };
}

function inputTable(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelTable {
  return findTable(context, typeof spec.inputTable === "string" ? spec.inputTable : context.tables[0]?.name ?? "");
}

function findTable(context: ExcelOperationContext, name: string): ExcelTable {
  const table = context.tables.find((candidate) => candidate.name === name);
  if (!table) {
    throw new Error(`Excel table not found: ${name}.`);
  }
  return table;
}

function requireColumn(table: ExcelTable, column: string): void {
  if (!table.headers.includes(column)) {
    throw new Error(`Column ${column} was not found in table ${table.name}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function outputName(spec: ExcelOperationSpec, fallback: string): string {
  return typeof spec.options.outputName === "string" && spec.options.outputName.trim() ? spec.options.outputName.trim() : fallback;
}

function normalizeValue(value: ExcelCell): string {
  if (isExcelValue(value)) {
    if (value.kind === "date") return value.value.toISOString().slice(0, 10).toLowerCase();
    if (value.kind === "datetime") return value.value.toISOString().toLowerCase();
    return String(value.value ?? "").trim().toLowerCase();
  }
  return String(value ?? "").trim().toLowerCase();
}

function isExcelValue(value: ExcelCell): value is ExcelValue {
  return Boolean(value && typeof value === "object" && "kind" in value && "value" in value);
}

function numericValue(value: ExcelCell): number | undefined {
  if (isExcelValue(value)) return value.kind === "number" ? value.value : undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const normalized = String(value ?? "").replace(/[$,%\s,]/g, "");
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header) => {
    const count = counts.get(header) ?? 0;
    counts.set(header, count + 1);
    return count === 0 ? header : `${header} (${count + 1})`;
  });
}

function failedOperation(spec: ExcelOperationSpec, message: string): ExcelOperationResult {
  const diagnostic: ExcelDiagnostic = { severity: "error", code: "OPERATION_FAILED", message };
  return { operationId: spec.id, kind: spec.kind, facts: { valid: false }, diagnostics: [diagnostic] };
}

function compareRowsOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const firstRow = requiredRowNumber(spec.options.firstRow, "first row");
  const secondRow = requiredRowNumber(spec.options.secondRow, "second row");
  const first = dataRow(table, firstRow);
  const second = dataRow(table, secondRow);
  const columns = table.headers;
    const matchRow = Object.fromEntries(columns.map((column) => [
      column,
      normalizeValue(first[column]) === normalizeValue(second[column])
    ]));
    const rows = [first, second, matchRow];
  const matchingColumns = columns.filter((column) => normalizeValue(first[column]) === normalizeValue(second[column])).length;
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${table.name}_row_comparison`), headers: columns, rows },
    facts: {
      firstRow,
      secondRow,
      comparedColumns: columns.length,
      matchingColumns,
      mismatchingColumns: columns.length - matchingColumns,
      overallMatch: matchingColumns === columns.length
    },
    diagnostics: []
  };
}

function requiredRowNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2) {
    throw new Error(`${label} must be an Excel row number of 2 or greater.`);
  }
  return value;
}

function dataRow(table: ExcelTable, excelRowNumber: number): ExcelRow {
  const row = table.rows[excelRowNumber - 2];
  if (!row) {
    throw new Error(`Excel row ${excelRowNumber} was not found in table ${table.name}.`);
  }
  return row;
}

function summarizeOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const sumColumn = requiredString(spec.options.sumColumn, "sum column");
  requireColumn(table, sumColumn);
  let total = 0;
  let count = 0;
  const diagnostics: ExcelDiagnostic[] = [];
  table.rows.forEach((row, index) => {
    const value = numericValue(row[sumColumn]);
    if (value === undefined) {
      diagnostics.push({ severity: "warning", code: "NON_NUMERIC_VALUE", message: `Value in ${sumColumn} is not numeric.`, tableName: table.name, rowNumber: index + 2, columnName: sumColumn });
      return;
    }
    total += value;
    count += 1;
  });
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${table.name}_summary`), headers: ["Column", "Count", "Total"], rows: [{ Column: sumColumn, Count: count, Total: total }] },
    facts: { column: sumColumn, count, total },
    diagnostics
  };
}

function isDateValue(value: ExcelCell): boolean {
  if (isExcelValue(value)) return value.kind === "date" || value.kind === "datetime";
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return false;
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp);
}

function stringOptions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : [];
}

function recordOfStringArrays(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, entries]) => [key, stringOptions(entries)]).filter(([, entries]) => entries.length > 0));
}

function checkValuesOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const table = inputTable(spec, context);
  const matchColumn = requiredString(spec.options.matchColumn, "match column");
  const matchValue = spec.options.matchValue as ExcelCell;
  const checks = Array.isArray(spec.options.checks)
    ? spec.options.checks.filter((value): value is { column: string; expected: ExcelCell } => Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { column?: unknown }).column === "string" && "expected" in value)
    : [];
  if (checks.length === 0) {
    throw new Error("At least one value check is required.");
  }
  requireColumn(table, matchColumn);
  checks.forEach((check) => requireColumn(table, check.column));

  const matchingRows = table.rows.filter((row) => valuesMatch(row[matchColumn], matchValue, matchColumn));
  const diagnostics: ExcelDiagnostic[] = [];
  if (matchingRows.length === 0) {
    diagnostics.push({ severity: "error", code: "ROW_NOT_FOUND", message: `No row matched ${matchColumn}: ${String(matchValue ?? "")}.`, tableName: table.name, columnName: matchColumn });
  }
  if (matchingRows.length > 1) {
    diagnostics.push({ severity: "error", code: "MULTIPLE_ROWS_FOUND", message: `${matchingRows.length} rows matched ${matchColumn}: ${String(matchValue ?? "")}.`, tableName: table.name, columnName: matchColumn });
  }

  const row = matchingRows.length === 1 ? matchingRows[0] : undefined;
  const rows = row
    ? checks.map((check) => ({
      Column: check.column,
      Expected: check.expected,
      Actual: row[check.column] ?? "",
      Match: valuesMatch(row[check.column], check.expected, check.column)
    }))
    : [];
  const matchingColumns = rows.filter((result) => result.Match).length;
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${table.name}_value_checks`), headers: ["Column", "Expected", "Actual", "Match"], rows },
    facts: {
      matchColumn,
      matchValue,
      matchedRows: matchingRows.length,
      checkedColumns: checks.length,
      matchingColumns,
      mismatchingColumns: checks.length - matchingColumns,
      valid: diagnostics.length === 0 && matchingColumns === checks.length
    },
    diagnostics
  };
}

function valuesMatch(actual: ExcelCell, expected: ExcelCell, columnName?: string): boolean {
  if (isExcelValue(actual) && (actual.kind === "date" || actual.kind === "datetime")) {
    const expectedDate = isExcelValue(expected) && (expected.kind === "date" || expected.kind === "datetime") ? expected.value : typeof expected === "string" ? new Date(expected) : undefined;
    return Boolean(expectedDate && Number.isFinite(expectedDate.getTime()) && actual.value.getTime() === expectedDate.getTime());
  }
  if (isDateColumnName(columnName) || (isDateValue(actual) && isDateValue(expected) && (isDateTextValue(actual) || isDateTextValue(expected)))) {
    return dateKey(actual) === dateKey(expected);
  }
  const actualNumber = numericValue(actual);
  const expectedNumber = numericValue(expected);
  if (actualNumber !== undefined && expectedNumber !== undefined) {
    return actualNumber === expectedNumber;
  }
  return normalizeValue(actual) === normalizeValue(expected);
}

function isDateColumnName(columnName?: string): boolean {
  return typeof columnName === "string" && /(?:^|[\s_()-])(date|datetime|timestamp|time)(?:$|[\s_()-])/i.test(columnName);
}

function isDateTextValue(value: ExcelCell): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim();
  return /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})(?:[T\s].*)?$/.test(normalized)
    || (/[-/]/.test(normalized) && Number.isFinite(Date.parse(normalized)));
}

function excelSerialDateKey(value: number): string | undefined {
  if (!Number.isFinite(value) || value < 1 || value > 2_958_465) {
    return undefined;
  }
  const milliseconds = Math.round((value - 25569) * 86_400_000);
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return undefined;
  }
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function dateKey(value: ExcelCell): string {
  if (typeof value === "number") {
    return excelSerialDateKey(value) ?? String(value);
  }
  const normalized = String(value ?? "").trim();
  const slashDate = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashDate) {
    const year = slashDate[3].length === 2 ? Number(slashDate[3]) + 2000 : Number(slashDate[3]);
    return `${year}-${Number(slashDate[1])}-${Number(slashDate[2])}`;
  }
  const isoDate = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    return `${Number(isoDate[1])}-${Number(isoDate[2])}-${Number(isoDate[3])}`;
  }
  const date = new Date(Date.parse(normalized));
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function compareVersionsOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const oldTable = findTable(context, requiredString(spec.options.oldTable, "old table"));
  const newTable = findTable(context, requiredString(spec.options.newTable, "new table"));
  const key = requiredString(spec.options.key, "comparison key");
  const columns = Array.isArray(spec.options.columns) && spec.options.columns.length > 0
    ? stringOptions(spec.options.columns)
    : oldTable.headers.filter((column) => column !== key && newTable.headers.includes(column));
  requireColumn(oldTable, key);
  requireColumn(newTable, key);
  columns.forEach((column) => {
    requireColumn(oldTable, column);
    requireColumn(newTable, column);
  });

  const diagnostics: ExcelDiagnostic[] = [];
  const oldByKey = indexVersionRows(oldTable, key, diagnostics, "old");
  const newByKey = indexVersionRows(newTable, key, diagnostics, "new");
  const keys = [...new Set([...oldByKey.keys(), ...newByKey.keys()])];
  const rows = keys.map((keyValue) => {
    const oldRow = oldByKey.get(keyValue);
    const newRow = newByKey.get(keyValue);
    const status = !oldRow ? "ADDED" : !newRow ? "DELETED" : columns.every((column) => valuesMatch(oldRow[column], newRow[column], column)) ? "UNCHANGED" : "CHANGED";
    return {
      [key]: keyValue,
      Status: status,
      ...Object.fromEntries(columns.flatMap((column) => [[`${column} (old)`, oldRow?.[column] ?? ""], [`${column} (new)`, newRow?.[column] ?? ""]]))
    };
  });
  const changedRows = rows.filter((row) => row.Status === "CHANGED");
  const addedRows = rows.filter((row) => row.Status === "ADDED");
  const deletedRows = rows.filter((row) => row.Status === "DELETED");
  const includeUnchanged = spec.options.includeUnchanged === true;
  const outputRows = includeUnchanged ? rows : rows.filter((row) => row.Status !== "UNCHANGED");
  const headers = Object.keys(outputRows[0] ?? { [key]: "", Status: "" });

  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, `${oldTable.name}_to_${newTable.name}_version_comparison`), headers, rows: outputRows },
    facts: {
      oldTable: oldTable.name,
      newTable: newTable.name,
      key,
      comparedColumns: columns.length,
      oldRows: oldTable.rows.length,
      newRows: newTable.rows.length,
      changed: changedRows.length,
      added: addedRows.length,
      deleted: deletedRows.length,
      unchanged: rows.length - changedRows.length - addedRows.length - deletedRows.length,
      valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error")
    },
    diagnostics
  };
}

function indexVersionRows(table: ExcelTable, key: string, diagnostics: ExcelDiagnostic[], version: string): Map<string, ExcelRow> {
  const indexed = new Map<string, ExcelRow>();
  table.rows.forEach((row, index) => {
    const keyValue = normalizeValue(row[key]);
    if (!keyValue) {
      diagnostics.push({ severity: "error", code: "BLANK_COMPARISON_KEY", message: `${version} table contains a blank ${key}.`, tableName: table.name, rowNumber: index + 2, columnName: key });
      return;
    }
    if (indexed.has(keyValue)) {
      diagnostics.push({ severity: "error", code: "DUPLICATE_COMPARISON_KEY", message: `${version} table contains duplicate ${key}: ${keyValue}.`, tableName: table.name, rowNumber: index + 2, columnName: key });
      return;
    }
    indexed.set(keyValue, row);
  });
  return indexed;
}

function summarizeMultipleOperation(spec: ExcelOperationSpec, context: ExcelOperationContext): ExcelOperationResult {
  const tableNames = stringOptions(spec.options.tables);
  if (tableNames.length === 0) {
    throw new Error("At least one table is required for a multiple-table summary.");
  }
  const sumColumn = requiredString(spec.options.sumColumn, "sum column");
  const diagnostics: ExcelDiagnostic[] = [];
  let grandCount = 0;
  let grandTotal = 0;
  const rows = tableNames.map((tableName) => {
    const table = findTable(context, tableName);
    if (!table.headers.includes(sumColumn)) {
      diagnostics.push({ severity: "error", code: "MISSING_COLUMN", message: `Column ${sumColumn} was not found.`, tableName: table.name, columnName: sumColumn });
      return { Table: table.name, "Source File": table.sourceFile ?? "", Count: 0, Total: 0 };
    }

    let count = 0;
    let total = 0;
    table.rows.forEach((row, index) => {
      const value = numericValue(row[sumColumn]);
      if (value === undefined) {
        diagnostics.push({ severity: "warning", code: "NON_NUMERIC_VALUE", message: `Value in ${sumColumn} is not numeric.`, tableName: table.name, rowNumber: index + 2, columnName: sumColumn });
        return;
      }
      count += 1;
      total += value;
    });
    grandCount += count;
    grandTotal += total;
    return { Table: table.name, "Source File": table.sourceFile ?? "", Count: count, Total: total };
  });

  rows.push({ Table: "Grand Total", "Source File": "", Count: grandCount, Total: grandTotal });
  return {
    operationId: spec.id,
    kind: spec.kind,
    table: { name: outputName(spec, "multi_table_summary"), headers: ["Table", "Source File", "Count", "Total"], rows },
    facts: { tables: tableNames, count: grandCount, total: grandTotal },
    diagnostics
  };
}
