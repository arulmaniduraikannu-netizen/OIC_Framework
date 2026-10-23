import { z } from "zod";
import { createDefaultExcelOperationRegistry } from "./excelAnalysisRegistry.js";
import type { ExcelOperationSpec, ExcelPromptPlan, ExcelTable, ExcelWorkbookSnapshot } from "../shared/types.js";
import { createCopilotClient } from "./copilotRunner.js";
import { getExcelCapabilityContracts } from "./excelCapabilities.js";
import { getExcelOperationCapabilities } from "./excelCapabilities.js";
import { registerExcelCopilotClient, registerExcelCopilotSession, unregisterExcelCopilotRun, type ExcelCopilotRunOptions } from "./excelCopilotRuntime.js";
import { settings } from "./config.js";
import { attachExcelSessionTelemetry } from "./excelSessionTelemetry.js";

const operationKinds = createDefaultExcelOperationRegistry().getOperationKinds() as [import("../shared/types.js").ExcelOperationKind, ...import("../shared/types.js").ExcelOperationKind[]];

const operationSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(operationKinds),
  inputTable: z.string().min(1).max(200).optional(),
  options: z.record(z.string(), z.unknown())
});

const promptPlanSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    operations: z.array(operationSchema).min(1).max(12),
    export: z.object({ format: z.literal("xlsx"), fileName: z.string().min(1).max(120).optional() }).optional(),
    executionPlan: z.object({
      steps: z.array(z.object({
        id: z.string().min(1).max(80),
        capability: z.literal("local-registry"),
        operation: operationSchema.optional(),
        export: z.object({ format: z.literal("xlsx"), fileName: z.string().min(1).max(120).optional() }).optional()
      })).min(1).max(13)
    }).optional(),
    explanation: z.string().max(500).optional()
  }),
  z.object({
    status: z.literal("needsClarification"),
    questions: z.array(z.string().trim().min(1).max(100000)).min(1).max(5),
    explanation: z.string().max(500).optional()
  }),
  z.object({
    status: z.literal("mcp"),
    reason: z.string().trim().min(1).max(500)
  }),
  z.object({
    status: z.literal("unsupported"),
    reason: z.string().trim().min(1).max(500)
  })
]);

export async function planExcelPrompt(snapshot: ExcelWorkbookSnapshot, prompt: string, options: ExcelCopilotRunOptions = {}): Promise<ExcelPromptPlan> {
  const client = await createCopilotClient();
  const runId = options.runId;
  if (runId) {
    registerExcelCopilotClient(runId, client);
  }
  try {
    const session = await client.createSession({
      clientName: "oic-excel-planner",
      model: process.env.OIC_RUNNER_MODEL || settings.model,
      workingDirectory: process.cwd(),
      configDirectory: process.cwd(),
      enableConfigDiscovery: true
    });
    if (runId) {
      registerExcelCopilotSession(runId, session);
    }
    try {
      const telemetry = attachExcelSessionTelemetry(session);
      const schema = snapshot.profiles;
      const plannerPrompt = [
          "Interpret the user's Excel request against the workbook schema and return JSON only.",
          "Return one of these shapes: { status: 'ready', operations: [{ id, kind, inputTable?, options }], export?: { format: 'xlsx', fileName? }, executionPlan: { steps: [{ id, capability: 'local-registry', operation? or export? }] }, explanation? }, { status: 'needsClarification', questions: [string], explanation? }, { status: 'mcp', reason }, or { status: 'unsupported', reason }.",
          `Allowed operation kinds: ${operationKinds.join(", ")}.`,
          "Use discover only when the user explicitly asks for workbook structure, sheet/table names, headers, or row counts. Never use discover as a fallback for a question about cell values or analysis.",
          "If a missing table, field, key, match value, or one-row-versus-all-rows scope could materially change the answer, return needsClarification and ask the minimum focused questions. Do not execute an operation while clarification is needed.",
          "Keep each clarification question concise and actionable, preferably under 300 characters.",
          "If the request is clear but cannot be represented by an allowed local operation, return mcp with a concise reason. Return unsupported only when the request cannot be safely analyzed.",
          `Available execution routes: ${JSON.stringify(getExcelCapabilityContracts())}`,
          `Available local operation contracts: ${JSON.stringify(getExcelOperationCapabilities().map(({ id, description, requiredInputs, optionalInputs, operators, aggregations, tableScope, rowScope, resultType, createsArtifact, limitations }) => ({ id, description, requiredInputs, optionalInputs, ...(operators ? { operators } : {}), ...(aggregations ? { aggregations } : {}), tableScope, rowScope, resultType, createsArtifact, limitations })))}`,
          "Use capability 'local-registry' for ready plans and capability 'excel-mcp' for mcp plans when returning the optional capability field.",
          "For requests to find matching records and return selected field values, use lookup with options { filters: [{ column, value, mode? }], columns: [exact header names], limit? }. Filters are ANDed; mode is equals or contains. Set allRows: true only when the user explicitly requests every row and provides no filter.",
          "Never use an empty lookup filter list unless allRows is true. Do not choose a matching row or field value on the user's behalf.",
          "For a request that provides explicit Column: Value pairs and asks to check, verify, or validate them, use checkValues with options { matchColumn, matchValue, checks: [{ column, expected }] }. Return only the requested checks, not the whole row.",
          "Use only exact table and column names from the workbook schema.",
          "For validation use validate options such as requiredColumns, uniqueColumn, nonBlankColumns, numericColumns, dateColumns, and allowedValues.",
          "When the user asks to export, download, save, or put results into an Excel sheet, return export: { format: 'xlsx', fileName? } in the ready plan. Export is an additional ordered step after the analysis operation; never omit it or treat the analysis table alone as completion.",
          "For arithmetic, matching, and validation facts, the local registry is authoritative. Do not calculate any result in the response.",
          "Never claim a result, inspect cell values, or calculate facts during planning. Local TypeScript operations remain authoritative for results.",
          `Workbook schema: ${JSON.stringify(schema)}`,
          `User request: ${prompt.trim()}`
        ].join("\n");
      let lastPlanningError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await session.sendAndWait({
          prompt: attempt === 1 ? plannerPrompt : [
            plannerPrompt,
            "Your previous response was not a valid executable plan.",
            `Validation failure: ${lastPlanningError instanceof Error ? lastPlanningError.message : String(lastPlanningError)}`,
            "Re-read the workbook schema. Map natural-language wording or minor spelling errors to a canonical header only when the match is unambiguous. Otherwise return needsClarification with the exact candidate table or column names. Return JSON only."
          ].join("\n"),
          mode: "immediate"
        }, Number(process.env.OIC_RUNNER_ANALYSIS_TIMEOUT_MS) || 120000);
        try {
          const content = result?.data.content ?? "";
          const parsed = promptPlanSchema.safeParse(JSON.parse(extractJson(content)));
          if (!parsed.success) {
            throw new Error(`Copilot returned an invalid Excel operation plan: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
          }
          if (parsed.data.status === "ready") {
            const readyPlan = normalizeMalformedComparisonPlan(parsed.data, snapshot, prompt);
            readyPlan.executionPlan ??= buildExecutionPlan(readyPlan);
            validateExecutionPlanShape(readyPlan);
            validatePlanTables(readyPlan, snapshot);
            return { ...readyPlan, telemetry };
          }
          return { ...parsed.data, telemetry };
        } catch (error) {
          lastPlanningError = error;
        }
      }
      return {
        status: "needsClarification",
        questions: ["I could not create a valid plan from the workbook schema. Please name the exact table and column, or describe which records and fields you want to analyze."],
        explanation: lastPlanningError instanceof Error ? lastPlanningError.message : "The planner did not return a valid executable plan.",
        telemetry
      };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  } finally {
    await client.stop().catch(() => undefined);
    if (runId) {
      unregisterExcelCopilotRun(runId);
    }
  }
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    return fenced;
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Copilot did not return a JSON Excel operation plan.");
  }
  return content.slice(start, end + 1);
}

function validatePlanTables(plan: Extract<ExcelPromptPlan, { status: "ready" }>, snapshot: ExcelWorkbookSnapshot): void {
  const tableNames = new Set(snapshot.tables.map((table) => table.name));
  plan.operations.forEach((operation) => {
    validateOperationShape(operation);
    if (operation.inputTable && !tableNames.has(operation.inputTable)) {
      throw new Error(`The planned input table ${operation.inputTable} was not found. Available tables: ${[...tableNames].join(", ")}.`);
    }
    if (operation.kind === "compare") {
      const rightTable = operation.options.rightTable;
      if (typeof rightTable === "string" && !tableNames.has(rightTable)) {
        throw new Error(`The planned comparison table ${rightTable} was not found. Available tables: ${[...tableNames].join(", ")}.`);
      }
    }
    if (operation.kind === "compareVersions") {
      for (const optionName of ["oldTable", "newTable"]) {
        const tableName = operation.options[optionName];
        if (typeof tableName === "string" && !tableNames.has(tableName)) {
          throw new Error(`The planned ${optionName} ${tableName} was not found. Available tables: ${[...tableNames].join(", ")}.`);
        }
      }
    }
    if (operation.kind === "lookup") {
      const inputTable = snapshot.tables.find((table) => table.name === (operation.inputTable ?? snapshot.tables[0]?.name));
      const columns = operation.options.columns;
      if (!Array.isArray(columns) || columns.length === 0 || columns.some((column) => typeof column !== "string")) {
        throw new Error("A lookup plan must specify one or more output columns.");
      }
      if (inputTable) {
        columns.forEach((column) => {
          if (!inputTable.headers.includes(column as string)) {
            throw new Error(`The planned lookup column ${String(column)} was not found in table ${inputTable.name}.`);
          }
        });
        const filters = operation.options.filters;
        if (filters !== undefined && !Array.isArray(filters)) {
          throw new Error("Lookup filters must be an array.");
        }
        (Array.isArray(filters) ? filters : []).forEach((filter, index) => {
          if (!filter || typeof filter !== "object" || Array.isArray(filter) || typeof (filter as { column?: unknown }).column !== "string") {
            throw new Error(`Lookup filter ${index + 1} must name an exact workbook column.`);
          }
          const column = (filter as { column: string }).column;
          if (!inputTable.headers.includes(column)) {
            throw new Error(`The planned lookup filter column ${column} was not found in table ${inputTable.name}.`);
          }
        });
      }
    }
    const inputTable = operation.inputTable ?? "table";
    const outputName = typeof operation.options.outputName === "string" && operation.options.outputName.trim()
      ? operation.options.outputName.trim()
      : operation.kind === "filter" ? `${inputTable}_filtered`
        : operation.kind === "lookup" ? `${inputTable}_lookup`
        : operation.kind === "group" ? `${inputTable}_grouped`
          : operation.kind === "summarize" ? `${inputTable}_summary`
            : operation.kind === "compareRows" ? `${inputTable}_row_comparison`
                : operation.kind === "checkValues" ? `${inputTable}_value_checks`
              : undefined;
    if (outputName) {
      tableNames.add(outputName);
    }
  });
}

export function normalizeMalformedComparisonPlan(plan: Extract<ExcelPromptPlan, { status: "ready" }>, snapshot: ExcelWorkbookSnapshot, _prompt: string): Extract<ExcelPromptPlan, { status: "ready" }> {
  const operations = plan.operations.map((operation) => {
    if (operation.kind !== "compareRows" || (typeof operation.options.firstRow === "number" && typeof operation.options.secondRow === "number")) {
      return operation;
    }
    const leftName = operation.inputTable;
    const rightName = typeof operation.options.rightTable === "string" ? operation.options.rightTable : undefined;
    const oldName = typeof operation.options.oldTable === "string" ? operation.options.oldTable : undefined;
    const newName = typeof operation.options.newTable === "string" ? operation.options.newTable : undefined;
    const left = snapshot.tables.find((table) => table.name === (leftName ?? oldName));
    const right = snapshot.tables.find((table) => table.name === (rightName ?? newName));
    if (!left || !right || left.name === right.name) return operation;
    const sharedHeaders = left.headers.filter((header) => right.headers.includes(header));
    const key = typeof operation.options.key === "string"
      ? operation.options.key
      : sharedHeaders.find((header) => /\b(?:id|key|number|code|transaction|order|invoice)\b/i.test(header) && uniqueColumn(left, header) && uniqueColumn(right, header))
        ?? sharedHeaders.find((header) => uniqueColumn(left, header) && uniqueColumn(right, header));
    if (!key) return operation;
    const columns = Array.isArray(operation.options.columns) && operation.options.columns.length > 0
      ? operation.options.columns.filter((column): column is string => typeof column === "string")
      : sharedHeaders.filter((header) => header !== key);
    const normalized: ExcelOperationSpec = oldName || newName
      ? { ...operation, kind: "compareVersions", inputTable: undefined, options: { oldTable: left.name, newTable: right.name, key, columns } }
      : { ...operation, kind: "compare", options: { rightTable: right.name, key, columns } };
    return normalized;
  });
  return { ...plan, operations, executionPlan: undefined };
}

function uniqueColumn(table: ExcelTable, column: string): boolean {
  const values = table.rows.map((row) => String(row[column] ?? "").trim()).filter(Boolean);
  return values.length > 0 && values.length === new Set(values).size;
}

function validateOperationShape(operation: Extract<ExcelPromptPlan, { status: "ready" }>["operations"][number]): void {
  const options = operation.options;
  const requireString = (name: string): void => {
    if (typeof options[name] !== "string" || !String(options[name]).trim()) {
      throw new Error(`The ${operation.kind} operation must specify ${name}.`);
    }
  };
  const requireStringArray = (name: string, required = false): void => {
    if (!Array.isArray(options[name]) || (required && options[name].length === 0) || options[name].some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`The ${operation.kind} operation must specify ${name} as ${required ? "a non-empty " : "an "}array of column names.`);
    }
  };

  switch (operation.kind) {
    case "filter":
      requireString("column");
      if (!("value" in options)) throw new Error("The filter operation must specify value.");
      break;
    case "lookup":
      requireStringArray("columns", true);
      break;
    case "group":
      requireString("groupBy");
      break;
    case "summarize":
      requireString("sumColumn");
      break;
    case "summarizeMultiple":
      requireStringArray("tables", true);
      requireString("sumColumn");
      break;
    case "compare":
      if (!operation.inputTable) throw new Error("The compare operation must specify one input table.");
      requireString("rightTable");
      if (options.rightTable === operation.inputTable) throw new Error("The compare operation must compare distinct tables.");
      requireString("key");
      requireStringArray("columns");
      break;
    case "compareVersions":
      requireString("oldTable");
      requireString("newTable");
      requireString("key");
      if (options.columns !== undefined) requireStringArray("columns");
      break;
    case "compareRows":
      if (!operation.inputTable) throw new Error("The compareRows operation must specify one input table.");
      if (typeof options.firstRow !== "number" || typeof options.secondRow !== "number") {
        throw new Error("The compareRows operation must specify firstRow and secondRow.");
      }
      if (!Number.isInteger(options.firstRow) || !Number.isInteger(options.secondRow) || options.firstRow < 2 || options.secondRow < 2) {
        throw new Error("The compareRows operation must use integer Excel row numbers of 2 or greater.");
      }
      break;
    case "checkValues":
      requireString("matchColumn");
      if (!Array.isArray(options.checks) || options.checks.length === 0) throw new Error("The checkValues operation must specify checks.");
      break;
    case "validate":
    case "discover":
      break;
  }
}

function buildExecutionPlan(plan: Extract<ExcelPromptPlan, { status: "ready" }>) {
  return {
    steps: [
      ...plan.operations.map((operation) => ({ id: operation.id, capability: "local-registry" as const, operation })),
      ...(plan.export ? [{ id: "export-xlsx", capability: "local-registry" as const, export: plan.export }] : [])
    ]
  };
}

export function validateExecutionPlanShape(plan: Extract<ExcelPromptPlan, { status: "ready" }>): void {
  const steps = plan.executionPlan?.steps ?? [];
  const stepIds = new Set<string>();
  steps.forEach((step) => {
    if (stepIds.has(step.id)) {
      throw new Error(`The execution plan contains duplicate step id ${step.id}.`);
    }
    stepIds.add(step.id);
    if ((step.operation ? 1 : 0) + (step.export ? 1 : 0) !== 1) {
      throw new Error(`Execution plan step ${step.id} must contain exactly one operation or export.`);
    }
  });

  const operationSteps = steps.filter((step) => step.operation);
  if (operationSteps.length !== plan.operations.length || operationSteps.some((step, index) => {
    const operation = plan.operations[index];
    return step.id !== operation.id || step.operation?.id !== operation.id || JSON.stringify(step.operation) !== JSON.stringify(operation);
  })) {
    throw new Error("The execution plan operations must match the declared operations in order.");
  }
  const exportSteps = steps.filter((step) => step.export);
  if (exportSteps.length !== (plan.export ? 1 : 0)) {
    throw new Error("The execution plan export steps must match the declared export request.");
  }
  if (exportSteps.length === 1) {
    const exportStep = exportSteps[0];
    if (steps.at(-1) !== exportStep || exportStep.id !== "export-xlsx" || JSON.stringify(exportStep.export) !== JSON.stringify(plan.export)) {
      throw new Error("The XLSX export must be the final execution plan step and match the declared export.");
    }
  }
}
