import assert from "node:assert/strict";
import test from "node:test";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { attachExcelSessionTelemetry, classifyExcelSessionWaitFailure, recordExcelFinish, recordMcpToolDenied } from "./excelSessionTelemetry.js";

test("collects Excel agent loop events", () => {
  let handler: ((event: SessionEvent) => void) | undefined;
  const session = {
    sessionId: "telemetry-session",
    on: (listener: (event: SessionEvent) => void) => {
      handler = listener;
      return () => undefined;
    }
  } as unknown as CopilotSession;

  const telemetry = attachExcelSessionTelemetry(session);
  handler?.({ type: "assistant.turn_start", data: { turnId: "1" } } as SessionEvent);
  handler?.({ type: "tool.execution_start", data: { toolCallId: "tool-1", toolName: "excel_filter" } } as SessionEvent);
  handler?.({ type: "session.task_complete", data: { success: true, summary: "done" } } as SessionEvent);
  handler?.({ type: "session.idle", data: {} } as SessionEvent);

  assert.equal(telemetry.sessionId, "telemetry-session");
  assert.equal(telemetry.turns, 1);
  assert.equal(telemetry.toolCalls, 1);
  assert.equal(telemetry.taskComplete, true);
  assert.equal(telemetry.taskCompleteSuccess, true);
  assert.equal(telemetry.idle, true);
  assert.equal(telemetry.lifecycleState, "planning");
  assert.deepEqual(telemetry.lifecycleTransitions?.map((transition) => transition.state), ["planning"]);
  assert.equal(telemetry.validation?.completed, false);
  assert.equal(telemetry.idleAborted, false);
});

test("records normal idle independently of optional task_complete", () => {
  let handler: ((event: SessionEvent) => void) | undefined;
  const session = {
    sessionId: "idle-without-task-complete",
    on: (listener: (event: SessionEvent) => void) => {
      handler = listener;
      return () => undefined;
    }
  } as unknown as CopilotSession;
  const telemetry = attachExcelSessionTelemetry(session);

  handler?.({ type: "session.idle", data: {} } as SessionEvent);

  assert.equal(telemetry.idle, true);
  assert.equal(telemetry.idleAborted, false);
  assert.equal(telemetry.taskComplete, false);
});

test("records failed tool execution separately from session errors", () => {
  let handler: ((event: SessionEvent) => void) | undefined;
  const session = {
    sessionId: "tool-failure",
    on: (listener: (event: SessionEvent) => void) => {
      handler = listener;
      return () => undefined;
    }
  } as unknown as CopilotSession;
  const telemetry = attachExcelSessionTelemetry(session);

  handler?.({ type: "tool.execution_complete", data: { success: false, toolCallId: "tool-1", error: { message: "budget denied" } } } as SessionEvent);

  assert.deepEqual(telemetry.toolFailures, ["budget denied"]);
  assert.deepEqual(telemetry.errors, []);
  assert.equal(classifyExcelSessionWaitFailure(new Error("tool failed"), 120000, telemetry), "toolError");
});

test("classifies only the installed SDK idle-wait timeout and matches its configured duration", () => {
  assert.equal(classifyExcelSessionWaitFailure(new Error("Timeout after 120000ms waiting for session.idle"), 120000), "idleTimeout");
  assert.equal(classifyExcelSessionWaitFailure(new Error("Timeout after 60000ms waiting for session.idle"), 120000), "sdkError");
  assert.equal(classifyExcelSessionWaitFailure(new Error("Timeout waiting for idle"), 120000), "sdkError");
  assert.equal(classifyExcelSessionWaitFailure(new Error("connection closed"), 120000), "sdkError");
  assert.equal(classifyExcelSessionWaitFailure("Timeout after 120000ms waiting for session.idle", 120000), "sdkError");
});

test("keeps session errors, cancellation, and tool failures distinct from idle timeout", () => {
  assert.equal(classifyExcelSessionWaitFailure(new Error("request failed"), 120000, {
    sessionId: "session-error", turns: 1, turnIds: [], toolCalls: 0, idle: false, errors: ["quota exceeded"], taskComplete: false, eventTypes: []
  }), "sessionError");
  assert.equal(classifyExcelSessionWaitFailure(new Error("request failed"), 120000, {
    sessionId: "session-aborted", turns: 1, turnIds: [], toolCalls: 0, idle: true, idleAborted: true, errors: [], taskComplete: false, eventTypes: []
  }), "aborted");
  assert.equal(classifyExcelSessionWaitFailure(new Error("tool handler failed"), 120000, {
    sessionId: "session-tool-error", turns: 1, turnIds: [], toolCalls: 1, idle: false, errors: [], toolFailures: ["operation failed"], taskComplete: false, eventTypes: []
  }), "toolError");
  assert.equal(classifyExcelSessionWaitFailure(new Error("Timeout after 120000ms waiting for session.idle"), 120000, {
    sessionId: "session-budget-abort", turns: 1, turnIds: [], toolCalls: 1, idle: false, errors: [], taskComplete: false, eventTypes: [],
    mcpBudget: { limits: { maxCalls: 1, maxRecoveries: 0, maxConsecutiveFailures: 1, maxDurationMs: 1 }, calls: 1, recoveries: 0, successes: 0, failures: 0, consecutiveFailures: 0, elapsedMs: 1, deadlineAborted: true }
  }), "aborted");
});

test("distinguishes native tool search, subsequent MCP capabilities, and MCP failures", () => {
  let handler: ((event: SessionEvent) => void) | undefined;
  const session = {
    sessionId: "native-tool-search",
    on: (listener: (event: SessionEvent) => void) => {
      handler = listener;
      return () => undefined;
    }
  } as unknown as CopilotSession;
  const telemetry = attachExcelSessionTelemetry(session);
  telemetry.nativeToolSearch = { enabled: true, invocationCount: 0, mcpCapabilitiesUsedAfterSearch: [] };

  handler?.({ type: "tool.execution_start", data: { toolCallId: "search-1", toolName: "tool_search_tool" } } as SessionEvent);
  handler?.({ type: "tool.execution_start", data: { toolCallId: "mcp-1", toolName: "excel-mcp_worksheet_transfer", mcpServerName: "excel-mcp", mcpToolName: "worksheet_transfer" } } as SessionEvent);
  handler?.({ type: "tool.execution_complete", data: { success: false, toolCallId: "mcp-1", error: { message: "Source file not found" } } } as SessionEvent);
  handler?.({ type: "session.idle", data: {} } as SessionEvent);

  assert.deepEqual(telemetry.nativeToolSearch, {
    enabled: true,
    invocationCount: 1,
    mcpCapabilitiesUsedAfterSearch: ["excel-mcp/worksheet_transfer"]
  });
  assert.deepEqual(telemetry.mcpCapabilitiesExecuted, ["excel-mcp/worksheet_transfer"]);
  assert.deepEqual(telemetry.mcpToolFailures, ["excel-mcp/worksheet_transfer: Source file not found"]);
  assert.equal(telemetry.idle, true);
});

test("tracks MCP call lifecycle, denials, durations, excel_finish, and idle", () => {
  let handler: ((event: SessionEvent) => void) | undefined;
  const session = {
    sessionId: "mcp-tool-lifecycle",
    on: (listener: (event: SessionEvent) => void) => {
      handler = listener;
      return () => undefined;
    }
  } as unknown as CopilotSession;
  const telemetry = attachExcelSessionTelemetry(session);

  handler?.({ type: "tool.execution_start", data: { toolCallId: "call-failed", toolName: "excel-mcp_read_cells", mcpServerName: "excel-mcp", mcpToolName: "read_cells" } } as SessionEvent);
  handler?.({ type: "tool.execution_start", data: { toolCallId: "call-denied", toolName: "excel-mcp_write_cells", mcpServerName: "excel-mcp", mcpToolName: "write_cells" } } as SessionEvent);
  handler?.({ type: "tool.execution_start", data: { toolCallId: "call-complete", toolName: "excel-mcp_download_file", mcpServerName: "excel-mcp", mcpToolName: "download_file" } } as SessionEvent);
  recordMcpToolDenied(telemetry, "excel-mcp_write_cells", "Output path is outside the staged directory.");
  handler?.({ type: "tool.execution_complete", data: { success: false, toolCallId: "call-failed", error: { message: "Source file not found" } } } as SessionEvent);
  handler?.({ type: "tool.execution_complete", data: { success: false, toolCallId: "call-denied", error: { message: "Denied by preToolUse hook" } } } as SessionEvent);
  handler?.({ type: "tool.execution_complete", data: { success: true, toolCallId: "call-complete" } } as SessionEvent);
  recordExcelFinish(telemetry, "mcpCompleted");
  handler?.({ type: "session.idle", data: {} } as SessionEvent);

  assert.deepEqual(telemetry.mcpToolLifecycle, {
    started: 3,
    completed: 1,
    failed: 1,
    denied: 1,
    inFlight: 0,
    totalDurationMs: telemetry.mcpToolLifecycle?.totalDurationMs,
    lastToolName: "download_file",
    calls: [
      { toolCallId: "call-failed", serverName: "excel-mcp", toolName: "read_cells", status: "failed", startedAt: telemetry.mcpToolLifecycle?.calls[0]?.startedAt, completedAt: telemetry.mcpToolLifecycle?.calls[0]?.completedAt, durationMs: telemetry.mcpToolLifecycle?.calls[0]?.durationMs, error: "Source file not found" },
      { toolCallId: "call-denied", serverName: "excel-mcp", toolName: "write_cells", status: "denied", startedAt: telemetry.mcpToolLifecycle?.calls[1]?.startedAt, completedAt: telemetry.mcpToolLifecycle?.calls[1]?.completedAt, durationMs: telemetry.mcpToolLifecycle?.calls[1]?.durationMs, error: "Output path is outside the staged directory." },
      { toolCallId: "call-complete", serverName: "excel-mcp", toolName: "download_file", status: "completed", startedAt: telemetry.mcpToolLifecycle?.calls[2]?.startedAt, completedAt: telemetry.mcpToolLifecycle?.calls[2]?.completedAt, durationMs: telemetry.mcpToolLifecycle?.calls[2]?.durationMs }
    ]
  });
  assert.equal(telemetry.applicationCompletionRecorded, true);
  assert.equal(telemetry.excelFinishRecorded, true);
  assert.equal(telemetry.excelFinishStatus, "mcpCompleted");
  assert.equal(telemetry.idle, true);
  assert.equal(telemetry.mcpToolFailures?.length, 2);
});