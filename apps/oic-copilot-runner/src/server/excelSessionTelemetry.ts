import type { CopilotSession, SessionEvent, ToolSearchConfig } from "@github/copilot-sdk";
import type { ExcelLifecycleState, ExcelSessionTelemetry, ExcelSessionWaitOutcome } from "../shared/types.js";

const SDK_IDLE_TIMEOUT_MESSAGE = /^Timeout after (\d+)ms waiting for session\.idle$/;

export const EXCEL_NATIVE_TOOL_SEARCH_CONFIG: ToolSearchConfig = { enabled: true };

export class ExcelSessionWaitError extends Error {
  constructor(message: string, readonly telemetry: ExcelSessionTelemetry) {
    super(message);
    this.name = "ExcelSessionWaitError";
  }
}

export function recordExcelFinish(telemetry: ExcelSessionTelemetry, status: string): void {
  telemetry.excelFinishRecorded = true;
  telemetry.excelFinishStatus = status;
  telemetry.applicationCompletionRecorded = true;
}

export function recordMcpToolDenied(telemetry: ExcelSessionTelemetry, toolName: string, reason: string): void {
  const lifecycle = telemetry.mcpToolLifecycle;
  if (!lifecycle) return;
  const normalizedName = normalizeMcpToolName(toolName);
  const call = [...lifecycle.calls].reverse().find((candidate) =>
    candidate.status === "inFlight" && normalizeMcpToolName(candidate.toolName) === normalizedName
  );
  const deniedAt = new Date();
  if (call) {
    call.status = "denied";
    call.completedAt = deniedAt.toISOString();
    call.durationMs = Math.max(0, deniedAt.getTime() - Date.parse(call.startedAt));
    call.error = reason;
    lifecycle.inFlight = Math.max(0, lifecycle.inFlight - 1);
    lifecycle.totalDurationMs += call.durationMs;
  } else {
    lifecycle.calls.push({
      toolCallId: `denied-${lifecycle.calls.length + 1}`,
      serverName: "excel-mcp",
      toolName: normalizedName,
      status: "denied",
      startedAt: deniedAt.toISOString(),
      completedAt: deniedAt.toISOString(),
      durationMs: 0,
      error: reason
    });
  }
  lifecycle.denied += 1;
  if (!call) lifecycle.lastToolName = normalizedName;
  telemetry.mcpToolFailures ??= [];
  telemetry.mcpToolFailures.push(`excel-mcp/${normalizedName}: ${reason}`);
}

function normalizeMcpToolName(toolName: string): string {
  return toolName
    .replace(/^mcp__excel-mcp__/, "")
    .replace(/^excel-mcp[-_/]/, "")
    .replace(/^excel_mcp_/, "");
}

export function classifyExcelSessionWaitFailure(error: unknown, timeoutMs: number, telemetry?: ExcelSessionTelemetry): ExcelSessionWaitOutcome {
  if (telemetry?.idleAborted || telemetry?.mcpBudget?.deadlineAborted) return "aborted";
  if (telemetry?.errors.length) return "sessionError";
  if (error instanceof Error) {
    const timeoutMatch = SDK_IDLE_TIMEOUT_MESSAGE.exec(error.message);
    if (timeoutMatch && Number(timeoutMatch[1]) === timeoutMs) return "idleTimeout";
  }
  if (telemetry?.toolFailures?.length) return "toolError";
  return "sdkError";
}

export function transitionExcelLifecycle(telemetry: ExcelSessionTelemetry, state: ExcelLifecycleState, reason?: string): void {
  telemetry.lifecycleState = state;
  telemetry.lifecycleTransitions ??= [];
  telemetry.lifecycleTransitions.push({ state, at: new Date().toISOString(), ...(reason ? { reason } : {}) });
}

export function recordExcelValidation(telemetry: ExcelSessionTelemetry, passed: boolean, evidence: string[], errors: string[] = []): void {
  telemetry.validation = { started: true, completed: true, passed, evidence, errors };
}

export function attachExcelSessionTelemetry(session: CopilotSession, toolSearchConfig?: ToolSearchConfig): ExcelSessionTelemetry {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: session.sessionId,
    turns: 0,
    turnIds: [],
    toolCalls: 0,
    idle: false,
    errors: [],
    taskComplete: false,
    excelFinishRecorded: false,
    mcpToolLifecycle: {
      started: 0,
      completed: 0,
      failed: 0,
      denied: 0,
      inFlight: 0,
      totalDurationMs: 0,
      calls: []
    },
    eventTypes: [],
    ...(toolSearchConfig ? {
      nativeToolSearch: {
        enabled: toolSearchConfig.enabled !== false,
        ...(toolSearchConfig.deferThreshold !== undefined ? { deferThreshold: toolSearchConfig.deferThreshold } : {}),
        invocationCount: 0,
        mcpCapabilitiesUsedAfterSearch: []
      }
    } : {}),
    lifecycleState: "planning",
    lifecycleTransitions: [],
    validation: { started: false, completed: false, passed: false, evidence: [], errors: [] }
  };
  const mcpToolsByCallId = new Map<string, import("../shared/types.js").ExcelMcpToolCallTelemetry>();
  transitionExcelLifecycle(telemetry, "planning");

  session.on((event: SessionEvent) => {
    telemetry.eventTypes.push(event.type);
    switch (event.type) {
      case "assistant.turn_start":
        telemetry.turns += 1;
        telemetry.turnIds.push(event.data.turnId);
        break;
      case "tool.execution_start":
        telemetry.toolCalls += 1;
        if (event.data.toolName === "tool_search_tool" && telemetry.nativeToolSearch) {
          telemetry.nativeToolSearch.invocationCount += 1;
        }
        if (event.data.mcpServerName && event.data.mcpToolName) {
          const capability = `${event.data.mcpServerName}/${event.data.mcpToolName}`;
          const lifecycle = telemetry.mcpToolLifecycle!;
          const call = {
            toolCallId: event.data.toolCallId,
            serverName: event.data.mcpServerName,
            toolName: event.data.mcpToolName,
            status: "inFlight" as const,
            startedAt: new Date().toISOString()
          };
          lifecycle.started += 1;
          lifecycle.inFlight += 1;
          lifecycle.lastToolName = call.toolName;
          lifecycle.calls.push(call);
          telemetry.mcpCapabilitiesExecuted ??= [];
          if (!telemetry.mcpCapabilitiesExecuted.includes(capability)) telemetry.mcpCapabilitiesExecuted.push(capability);
          mcpToolsByCallId.set(event.data.toolCallId, call);
          if (telemetry.nativeToolSearch?.invocationCount) {
            const discoveredCapabilities = telemetry.nativeToolSearch.mcpCapabilitiesUsedAfterSearch;
            if (!discoveredCapabilities.includes(capability)) discoveredCapabilities.push(capability);
          }
        }
        break;
      case "session.idle":
        telemetry.idle = true;
        telemetry.idleAborted = event.data.aborted === true;
        break;
      case "tool.execution_complete":
        {
          const call = mcpToolsByCallId.get(event.data.toolCallId);
          const denialAlreadyRecorded = call?.status === "denied";
          if (call) {
            const lifecycle = telemetry.mcpToolLifecycle!;
            call.completedAt = new Date().toISOString();
            call.durationMs = Math.max(0, Date.now() - Date.parse(call.startedAt));
            if (!event.data.success && !denialAlreadyRecorded) {
              call.error = event.data.error?.message ?? "Tool execution failed.";
            }
            if (call.status === "inFlight") {
              const denied = !event.data.success && /denied|permission/i.test(call.error ?? "");
              call.status = event.data.success ? "completed" : denied ? "denied" : "failed";
              lifecycle.inFlight = Math.max(0, lifecycle.inFlight - 1);
              lifecycle.totalDurationMs += call.durationMs;
              if (event.data.success) lifecycle.completed += 1;
              else if (denied) lifecycle.denied += 1;
              else lifecycle.failed += 1;
            }
          }
          if (!event.data.success) {
          telemetry.toolFailures ??= [];
          telemetry.toolFailures.push(event.data.error?.message ?? "Tool execution failed.");
          if (call && !denialAlreadyRecorded) {
            telemetry.mcpToolFailures ??= [];
            telemetry.mcpToolFailures.push(`${call.serverName}/${call.toolName}: ${event.data.error?.message ?? "Tool execution failed."}`);
          }
          }
          mcpToolsByCallId.delete(event.data.toolCallId);
        }
        break;
      case "session.error":
        telemetry.errors.push(event.data.message);
        transitionExcelLifecycle(telemetry, "failed", event.data.message);
        break;
      case "session.task_complete":
        telemetry.taskComplete = true;
        telemetry.taskCompleteSuccess = event.data.success;
        telemetry.taskCompleteSummary = event.data.summary;
        telemetry.taskCompleteReason = event.data.reason;
        break;
    }
  });

  return telemetry;
}