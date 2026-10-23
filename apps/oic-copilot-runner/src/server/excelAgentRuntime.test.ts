import assert from "node:assert/strict";
import test from "node:test";
import { addExcelMcpInputSchemas, assembleResponse, buildSystemInstructions, canAcceptInteractiveExcelCompletion, canPreserveExcelCompletionAfterWaitFailure, getExcelAgentMcpToolDenialReason, getExcelPostToolContext, isExcelMcpToolName, isLocalExcelCapabilityId, recordExcelCompletion, validateExecutionPlan, type ExcelCompletionState } from "./excelAgentRuntime.js";
import { EXCEL_NATIVE_TOOL_SEARCH_CONFIG, recordExcelValidation, transitionExcelLifecycle } from "./excelSessionTelemetry.js";
import type { ExcelSessionTelemetry } from "../shared/types.js";
import { tableFromRows } from "./excelAnalysisRegistry.js";
import { createExcelRuntimeTools } from "./excelRuntimeTools.js";
import { getExcelCapabilityContracts, getExcelOperationCapabilities } from "./excelCapabilities.js";
import type { ExcelWorkbookSnapshot } from "../shared/types.js";

const completion = {
  status: "completed" as const,
  explanation: "validated local result"
};

const genericSnapshot: ExcelWorkbookSnapshot = {
  files: ["source.xlsx"],
  tables: [tableFromRows("source", [["Key", "Segment", "Metric"], ["A", "North", "2"], ["B", "South", "3"]], "source.xlsx")],
  profiles: [],
  diagnostics: []
};

test("main Excel runtime explicitly enables SDK-native tool search without overriding its threshold", () => {
  assert.deepEqual(EXCEL_NATIVE_TOOL_SEARCH_CONFIG, { enabled: true });
  assert.equal("deferThreshold" in EXCEL_NATIVE_TOOL_SEARCH_CONFIG, false);
});

async function invokeRuntimeTool(tools: ReturnType<typeof createExcelRuntimeTools>, name: string, args: unknown): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `Expected ${name} to be registered.`);
  assert.ok(tool.handler, `Expected ${name} to have a handler.`);
  return await (tool.handler as (handlerArgs: unknown, invocation: { sessionId: string; toolCallId: string; toolName: string; arguments: unknown }) => Promise<unknown>)(args, {
    sessionId: "test-session",
    toolCallId: `test-${name}`,
    toolName: name,
    arguments: args
  });
}

test("runtime instructions consume the registry catalog and define generic local-first boundaries", () => {
  const instructions = buildSystemInstructions(genericSnapshot, [{ name: "source.xlsx", path: "001-source.xlsx" }]);
  const localCapabilities = getExcelOperationCapabilities();

  assert.match(instructions, /GitHub Copilot SDK/);
  assert.match(instructions, /Multiple local steps do not justify MCP/);
  assert.match(instructions, /XLSX.*not reasons to select MCP/);
  assert.match(instructions, /do not redo, re-export, or re-read completed local work through MCP/);
  assert.match(instructions, /use local tools for supported portions and MCP only for the unsupported portion/);
  assert.match(instructions, /Before any Excel MCP call, use excel_request_mcp/);
  assert.match(instructions, /Deterministic result contract/);
  assert.match(instructions, /After each deterministic operation, compare its result and diagnostics with the original request/);
  assert.match(instructions, /Do not add discovery, lookup, filter, validation, export, or MCP operations just to inspect/);
  assert.match(instructions, /Continue only for explicitly requested work that remains/);
  assert.match(instructions, /Capability routes:/);
  assert.match(instructions, /"valueTypes"/);
  for (const capability of localCapabilities) {
    assert.ok(instructions.includes(`"id":"${capability.id}"`), `Expected catalog capability ${capability.id} in runtime guidance.`);
  }
  assert.equal(localCapabilities.some((capability) => String(capability.id) === "sort"), false);
  assert.equal(isLocalExcelCapabilityId("compare"), true);
  assert.equal(isLocalExcelCapabilityId("exportXlsx"), true);
  assert.equal(isLocalExcelCapabilityId("sort"), false);
  assert.equal(isLocalExcelCapabilityId("group with median aggregation"), false);
  const capabilityRoutes = getExcelCapabilityContracts();
  assert.deepEqual(capabilityRoutes[0]?.operationKinds, localCapabilities.slice(0, -1).map((capability) => capability.id));
  assert.equal(capabilityRoutes[1]?.id, "excel-mcp");
  assert.match(instructions, /Use Excel MCP only for a clear requested operation that the local catalog cannot represent/);
  assert.doesNotMatch(instructions, /event date|transaction number/i);
});

test("MCP execution requires an explicit unsupported capability and remains staged-path guarded", () => {
  const toolName = "mcp__excel-mcp__read_cells";
  const stagedArguments = { file_path: "001-source.xlsx" };

  assert.match(getExcelAgentMcpToolDenialReason(toolName, stagedArguments, ".", true, undefined) ?? "", /excel_request_mcp/);
  assert.equal(getExcelAgentMcpToolDenialReason(toolName, stagedArguments, ".", true, { operation: "sort", reason: "Sorting is not represented locally." }), undefined);
  assert.match(getExcelAgentMcpToolDenialReason(toolName, { file_path: "../outside.xlsx" }, ".", true, { operation: "sort", reason: "Sorting is not represented locally." }) ?? "", /only files staged/);
  assert.match(getExcelAgentMcpToolDenialReason(toolName, stagedArguments, ".", false, { operation: "sort", reason: "Sorting is not represented locally." }) ?? "", /disabled/);
});

test("supported comparison completes from local results without MCP provenance", async () => {
  const snapshot: ExcelWorkbookSnapshot = {
    ...genericSnapshot,
    files: ["baseline.csv", "current.csv"],
    tables: [
      tableFromRows("baseline", [["Key", "Metric"], ["A", "2"]], "baseline.csv"),
      tableFromRows("current", [["Key", "Metric"], ["A", "4"]], "current.csv")
    ]
  };
  const executions: Parameters<typeof assembleResponse>[2] = [];
  const tools = createExcelRuntimeTools(snapshot, { onExecution: (execution) => executions.push(execution) });
  const localResult = await invokeRuntimeTool(tools, "excel_compare", {
    table: "baseline",
    rightTable: "current",
    key: "Key",
    columns: ["Metric"]
  }) as { kind: string };

  const response = assembleResponse(snapshot, "Compare the two tables", executions, [], ["operation"], completion, 1, new Set());
  assert.equal(localResult.kind, "compare");
  assert.equal(response.status, "completed");
  if (response.status !== "completed") throw new Error("Expected local completion.");
  assert.equal(response.analysis.operations[0]?.kind, "compare");
});

test("multiple local operations compose without triggering MCP", async () => {
  const executions: Parameters<typeof assembleResponse>[2] = [];
  const tools = createExcelRuntimeTools(genericSnapshot, { onExecution: (execution) => executions.push(execution) });

  await invokeRuntimeTool(tools, "excel_filter", { table: "source", column: "Segment", value: "North", outputName: "selected" });
  await invokeRuntimeTool(tools, "excel_group", { table: "selected", groupBy: "Segment", sumColumn: "Metric", outputName: "local-summary" });

  const response = assembleResponse(genericSnapshot, "Filter and summarize", executions, [], ["operation", "operation"], completion, 1, new Set());
  assert.equal(response.status, "completed");
  if (response.status !== "completed") throw new Error("Expected multi-step local completion.");
  assert.deepEqual(response.analysis.operations.map((operation) => operation.kind), ["filter", "group"]);
  assert.deepEqual(response.analysis.operations[1]?.table?.rows, [{ Segment: "north", Count: 1, "Sum of Metric": 2 }]);
});

test("rejects completed status while a deterministic operation has an error diagnostic", async () => {
  const executions: Parameters<typeof assembleResponse>[2] = [];
  const tools = createExcelRuntimeTools(genericSnapshot, { onExecution: (execution) => executions.push(execution) });
  const failedResult = await invokeRuntimeTool(tools, "excel_lookup", {
    table: "source",
    columns: ["Missing column"],
    allRows: true
  }) as { diagnostics: Array<{ severity: string; message: string }> };

  assert.equal(failedResult.diagnostics[0]?.severity, "error");
  const response = assembleResponse(genericSnapshot, "Return the requested field", executions, [], ["operation"], completion, 1, new Set());

  assert.equal(response.status, "unsupported");
  assert.match(response.reason ?? "", /error diagnostic\(s\) remain after execution/);
});

test("preserves a focused clarification instead of converting it to completion", () => {
  const response = assembleResponse(genericSnapshot, "Compare rows", [], [], [], {
    status: "needsClarification",
    questions: ["Which two rows should I compare?"]
  }, 1, new Set());

  assert.equal(response.status, "needsClarification");
  if (response.status !== "needsClarification") throw new Error("Expected clarification.");
  assert.deepEqual(response.questions, ["Which two rows should I compare?"]);
});

test("MCP tool provenance excludes built-in completion and unrelated MCP tools", () => {
  assert.equal(isExcelMcpToolName("mcp__excel-mcp__read_cells"), true);
  assert.equal(isExcelMcpToolName("excel-mcp_read_cells"), true);
  assert.equal(isExcelMcpToolName("task_complete"), false);
  assert.equal(isExcelMcpToolName("mcp__playwright__snapshot"), false);
});

test("mixed completion retains local results separately from MCP provenance", async () => {
  const executions: Parameters<typeof assembleResponse>[2] = [];
  const tools = createExcelRuntimeTools(genericSnapshot, { onExecution: (execution) => executions.push(execution) });
  await invokeRuntimeTool(tools, "excel_filter", { table: "source", column: "Segment", value: "North", outputName: "selected" });

  const response = assembleResponse(genericSnapshot, "Filter and perform unsupported sorting", executions, [], ["operation"], {
    status: "mcpCompleted",
    answer: "The remaining requested operation was completed.",
    files: ["source.xlsx"],
    provenance: { sourceFiles: ["source.xlsx"], tables: [{ sourceFile: "source.xlsx", tableName: "source", columns: ["Key", "Segment", "Metric"] }] }
  }, 1, new Set(["mcp__excel-mcp__read_cells"]));

  assert.equal(response.status, "mcpCompleted");
  if (response.status !== "mcpCompleted") throw new Error("Expected mixed MCP completion.");
  assert.equal(response.source, "mbeps/excel-mcp");
  assert.equal(response.localVerification, "not-performed");
  assert.equal(response.localAnalysis?.operations[0]?.kind, "filter");
  assert.equal(response.provenance.tables[0]?.tableName, "source");
});

test("accepts the first completion and ignores duplicates across SDK turns", () => {
  const state: ExcelCompletionState = { acceptedCalls: 0, duplicateCalls: 0 };

  assert.deepEqual(recordExcelCompletion(state, completion), { accepted: true, duplicate: false });
  assert.deepEqual(recordExcelCompletion(state, { ...completion, explanation: "repeated turn" }), { accepted: false, duplicate: true });
  assert.equal(state.completion?.explanation, "validated local result");
  assert.equal(state.acceptedCalls, 1);
  assert.equal(state.duplicateCalls, 1);
});

test("accepts a structured completion without optional task_complete or idle events", () => {
  assert.equal(canAcceptInteractiveExcelCompletion(completion, {
    sessionId: "session-1",
    turns: 1,
    turnIds: ["turn-1"],
    toolCalls: 1,
    idle: false,
    errors: [],
    taskComplete: false,
    eventTypes: []
  }), true);
});

test("rejects a structured completion when the interactive session reports an error", () => {
  assert.equal(canAcceptInteractiveExcelCompletion(completion, {
    sessionId: "session-1",
    turns: 1,
    turnIds: ["turn-1"],
    toolCalls: 1,
    idle: true,
    errors: ["MCP disconnected"],
    taskComplete: false,
    eventTypes: []
  }), false);
});

test("preserves a schema-valid completion only after a classified idle timeout", () => {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "session-timeout",
    turns: 1,
    turnIds: ["turn-1"],
    toolCalls: 1,
    idle: false,
    errors: [],
    taskComplete: false,
    eventTypes: []
  };

  assert.equal(canPreserveExcelCompletionAfterWaitFailure(completion, telemetry, "idleTimeout"), true);
  assert.equal(canPreserveExcelCompletionAfterWaitFailure(undefined, telemetry, "idleTimeout"), false);
  assert.equal(canPreserveExcelCompletionAfterWaitFailure(completion, telemetry, "sdkError"), false);
  assert.equal(canPreserveExcelCompletionAfterWaitFailure(completion, telemetry, "sessionError"), false);
  assert.equal(canPreserveExcelCompletionAfterWaitFailure({ status: "finished" } as never, telemetry, "idleTimeout"), false);
});

test("does not preserve a completion when session error or abort follows excel_finish", () => {
  const errored: ExcelSessionTelemetry = {
    sessionId: "session-error-after-finish", turns: 1, turnIds: [], toolCalls: 1, idle: false,
    errors: ["service unavailable"], taskComplete: false, applicationCompletionRecorded: true, eventTypes: []
  };
  const aborted: ExcelSessionTelemetry = {
    sessionId: "session-abort-after-finish", turns: 1, turnIds: [], toolCalls: 1, idle: true, idleAborted: true,
    errors: [], taskComplete: false, applicationCompletionRecorded: true, eventTypes: []
  };

  assert.equal(canPreserveExcelCompletionAfterWaitFailure(completion, errored, "sessionError"), false);
  assert.equal(canPreserveExcelCompletionAfterWaitFailure(completion, aborted, "aborted"), false);
});

test("completion after idle timeout still fails if its planned export step is missing", async () => {
  const executions: Parameters<typeof assembleResponse>[2] = [];
  const tools = createExcelRuntimeTools(genericSnapshot, { onExecution: (execution) => executions.push(execution) });
  await invokeRuntimeTool(tools, "excel_filter", { table: "source", column: "Segment", value: "North" });
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "timeout-missing-artifact", turns: 1, turnIds: [], toolCalls: 1,
    idle: false, errors: [], taskComplete: false, eventTypes: [], waitOutcome: "idleTimeout"
  };
  const plan = { steps: [
    { id: "filter", capability: "local-registry" as const, operation: { id: "filter-op", kind: "filter" as const, inputTable: "source", options: { column: "Segment", value: "North" } } },
    { id: "required-export", capability: "local-registry" as const, export: { format: "xlsx" as const } }
  ] };

  const response = assembleResponse(genericSnapshot, "Return the result", executions, [], [], completion, 1, new Set(), [], plan, telemetry);

  assert.equal(response.status, "unsupported");
  assert.match(response.reason ?? "", /did not complete the ordered execution plan/);
  assert.equal(telemetry.validation?.passed, false);
});

test("records lifecycle transitions and validation evidence", () => {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "session-2",
    turns: 1,
    turnIds: ["turn-1"],
    toolCalls: 2,
    idle: true,
    errors: [],
    taskComplete: false,
    eventTypes: []
  };

  transitionExcelLifecycle(telemetry, "executing", "run started");
  transitionExcelLifecycle(telemetry, "validating", "checking result");
  recordExcelValidation(telemetry, true, ["plan conformance checked"]);

  assert.equal(telemetry.lifecycleState, "validating");
  assert.deepEqual(telemetry.lifecycleTransitions?.map((transition) => transition.state), ["executing", "validating"]);
  assert.deepEqual(telemetry.validation, {
    started: true,
    completed: true,
    passed: true,
    evidence: ["plan conformance checked"],
    errors: []
  });
});

test("rejects duplicate and non-local execution plan steps", () => {
  const duplicatePlan = {
    steps: [
      { id: "step-1", capability: "local-registry" as const, operation: { id: "op-1", kind: "discover" as const, options: {} } },
      { id: "step-1", capability: "local-registry" as const, operation: { id: "op-2", kind: "validate" as const, options: {} } }
    ]
  };
  const nonLocalPlan = {
    steps: [{ id: "step-1", capability: "excel-mcp" as const, operation: { id: "op-1", kind: "discover" as const, options: {} } }]
  };

  assert.match(validateExecutionPlan(duplicatePlan, [], [], [] ) ?? "", /duplicate step ids/);
  assert.match(validateExecutionPlan(nonLocalPlan, [], [], [] ) ?? "", /non-local capability/);
});

test("supports bounded MCP recovery telemetry", () => {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "session-mcp",
    turns: 2,
    turnIds: ["turn-1", "turn-2"],
    toolCalls: 1,
    idle: true,
    errors: [],
    taskComplete: false,
    eventTypes: [],
    mcpRecoveryAttempts: 2,
    mcpRecoveryFailures: ["Attempt 1 returned an incomplete or failure response."]
  };

  transitionExcelLifecycle(telemetry, "mcpRecovery", "MCP recovery attempt 2 of 2");
  assert.equal(telemetry.mcpRecoveryAttempts, 2);
  assert.deepEqual(telemetry.mcpRecoveryFailures, ["Attempt 1 returned an incomplete or failure response."]);
  assert.equal(telemetry.lifecycleState, "mcpRecovery");
});

test("attaches input schemas from the normal session metadata to live MCP tool listings", () => {
  const inputSchema = { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] };
  const tools = addExcelMcpInputSchemas(
    [{ name: "read_cells", description: "Read workbook cells" }, { name: "list_sheets" }],
    [
      { name: "mcp__excel-mcp__read_cells", mcpServerName: "excel-mcp", mcpToolName: "read_cells", input_schema: inputSchema },
      { name: "mcp__playwright__navigate", mcpServerName: "playwright", mcpToolName: "navigate", input_schema: { type: "object" } }
    ],
    "excel-mcp"
  );

  assert.deepEqual(tools, [
    { name: "read_cells", description: "Read workbook cells", inputSchema },
    { name: "list_sheets" }
  ]);
});

test("post-tool context reinforces generic request reassessment without deciding the next tool", () => {
  const context = getExcelPostToolContext("excel_compare_rows");

  assert.match(context ?? "", /reassess the original user request/);
  assert.match(context ?? "", /exact headers, rows, facts, and diagnostics/);
  assert.match(context ?? "", /Continue only when an explicitly requested operation or output remains unsatisfied/);
  assert.match(context ?? "", /Do not call tools merely to inspect, reformat, or verify/);
  assert.equal(getExcelPostToolContext("excel_finish"), undefined);
  assert.equal(getExcelPostToolContext("excel_request_mcp"), undefined);
  assert.equal(getExcelPostToolContext("mcp__excel-mcp__read_cells"), undefined);
});