import fs from "node:fs/promises";
import path from "node:path";
import { BuiltInTools, defineTool, ToolSet } from "@github/copilot-sdk";
import { z } from "zod";
import type { CopilotSession } from "@github/copilot-sdk";
import type { ExcelAnalysisResult, ExcelDiagnostic, ExcelExecutionPlan, ExcelPromptResponse, ExcelSessionTelemetry, ExcelWorkbookSnapshot } from "../shared/types.js";
import { createCopilotClient } from "./copilotRunner.js";
import { paths, settings } from "./config.js";
import { registerExcelCopilotClient, registerExcelCopilotSession, unregisterExcelCopilotRun, type ExcelCopilotRunOptions } from "./excelCopilotRuntime.js";
import { buildExcelMcpServerConfig, getExcelMcpToolDenialReason, stageExcelFallbackInputs } from "./excelMcpFallback.js";
import { createExcelRuntimeTools, type ExcelRuntimeExportExecution, type ExcelRuntimeToolExecution } from "./excelRuntimeTools.js";
import { getExcelCapabilityContracts, getExcelOperationCapabilities } from "./excelCapabilities.js";
import type { ExcelMcpInputFile } from "./excelMcpFallback.js";
import { persistExcelArtifacts } from "./excelArtifactStore.js";
import { attachExcelSessionTelemetry, classifyExcelSessionWaitFailure, EXCEL_NATIVE_TOOL_SEARCH_CONFIG, recordExcelFinish, recordMcpToolDenied, recordExcelValidation, transitionExcelLifecycle } from "./excelSessionTelemetry.js";
import { ExcelMcpExecutionBudget, isExcelMcpToolName } from "./excelMcpExecutionBudget.js";

export { isExcelMcpToolName } from "./excelMcpExecutionBudget.js";

const EXCEL_MCP_SERVER_NAME = "excel-mcp";
const MAX_RESPONSE_ROWS_PER_TABLE = 100;
const MAX_PROFILE_SAMPLE_ROWS = 3;

const completionSchema = z.object({
  status: z.enum(["completed", "needsClarification", "mcpCompleted", "unsupported"]),
  explanation: z.string().trim().optional(),
  questions: z.array(z.string().trim().min(1)).optional(),
  answer: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  files: z.array(z.string().trim().min(1)).optional(),
  provenance: z.object({
    sourceFiles: z.array(z.string().trim().min(1)),
    tables: z.array(z.object({
      sourceFile: z.string().trim().min(1),
      tableName: z.string().trim().min(1),
      columns: z.array(z.string().trim().min(1))
    }))
  }).optional()
});

export type Completion = z.infer<typeof completionSchema>;

export interface ExcelCompletionState {
  completion?: Completion;
  acceptedCalls: number;
  duplicateCalls: number;
}

export function recordExcelCompletion(state: ExcelCompletionState, value: Completion): { accepted: boolean; duplicate: boolean } {
  if (state.completion) {
    state.duplicateCalls += 1;
    return { accepted: false, duplicate: true };
  }

  state.completion = value;
  state.acceptedCalls += 1;
  return { accepted: true, duplicate: false };
}

export function canAcceptInteractiveExcelCompletion(completion: Completion | undefined, telemetry: ExcelSessionTelemetry | undefined): boolean {
  return Boolean(completion && completionSchema.safeParse(completion).success && telemetry && telemetry.errors.length === 0 && !telemetry.idleAborted);
}

export function canPreserveExcelCompletionAfterWaitFailure(completion: Completion | undefined, telemetry: ExcelSessionTelemetry | undefined, failureKind: ExcelSessionTelemetry["waitOutcome"]): boolean {
  return failureKind === "idleTimeout" && canAcceptInteractiveExcelCompletion(completion, telemetry);
}

export function getExcelPostToolContext(toolName: string): string | undefined {
  if (!toolName.startsWith("excel_") || toolName === "excel_finish" || toolName === "excel_request_mcp") return undefined;
  return "After this deterministic operation, reassess the original user request against all accumulated results. Use only exact headers, rows, facts, and diagnostics returned by tools; do not infer or invent a result-table schema. Continue only when an explicitly requested operation or output remains unsatisfied, a diagnostic leaves requested work incomplete and a safe repair is available, or a requested artifact is still pending. If all requested work is satisfied with no unresolved errors or artifact step, call excel_finish and stop. Do not call tools merely to inspect, reformat, or verify an already sufficient result.";
}

export function addExcelMcpInputSchemas<T extends { name: string }>(
  advertisedTools: T[],
  sessionTools: Array<{ name: string; mcpServerName?: string; mcpToolName?: string; input_schema?: unknown }> | null,
  serverName: string
): Array<T & { inputSchema?: unknown }> {
  const schemaByToolName = new Map((sessionTools ?? [])
    .filter((toolMetadata) => toolMetadata.mcpServerName === serverName && toolMetadata.input_schema !== undefined)
    .map((toolMetadata) => [toolMetadata.mcpToolName ?? toolMetadata.name, toolMetadata.input_schema]));

  return advertisedTools.map((tool) => {
    const inputSchema = schemaByToolName.get(tool.name);
    return inputSchema === undefined ? { ...tool } : { ...tool, inputSchema };
  });
}

export function isLocalExcelCapabilityId(operation: string): boolean {
  const requestedId = operation.trim().toLowerCase();
  return getExcelOperationCapabilities().some((capability) => capability.id.toLowerCase() === requestedId);
}

export interface ExcelAgentRuntimeInput {
  files: ExcelMcpInputFile[];
  prompt: string;
  snapshot: ExcelWorkbookSnapshot;
  clarificationHint?: string;
  executionPlan?: ExcelExecutionPlan;
  options?: ExcelCopilotRunOptions;
}

export async function runExcelAgentRuntime(input: ExcelAgentRuntimeInput): Promise<ExcelPromptResponse> {
  const { files, prompt, snapshot, clarificationHint, options = {} } = input;
  const runId = options.runId;
  const executions: ExcelRuntimeToolExecution[] = [];
  const exports: ExcelRuntimeExportExecution[] = [];
  const executionEvents: Array<"operation" | "export"> = [];
  const mcpToolsUsed = new Set<string>();
  const completionState: ExcelCompletionState = { acceptedCalls: 0, duplicateCalls: 0 };
  let mcpEligibility: { operation: string; reason: string } | undefined;
  await fs.mkdir(paths.runtimeDataPath, { recursive: true });
  const stagingDirectory = await fs.mkdtemp(path.join(paths.runtimeDataPath, "excel-agent-"));

  try {
    const stagedFiles = await stageExcelFallbackInputs(files, stagingDirectory);
    const workspaceMcpConfig = JSON.parse(await fs.readFile(settings.mcpConfigPath, "utf8")) as unknown;
    const useMcp = !input.executionPlan;
    const mcpServer = useMcp ? buildExcelMcpServerConfig(workspaceMcpConfig, stagingDirectory) : undefined;
    const mcpBudget = new ExcelMcpExecutionBudget();
    const client = await createCopilotClient();
    if (runId) registerExcelCopilotClient(runId, client);
    let session: CopilotSession | undefined;
    let telemetry: ExcelSessionTelemetry | undefined;

    const abortForBudget = (reason: string): void => {
      if (telemetry) {
        telemetry.mcpBudget = mcpBudget.getSnapshot();
        telemetry.mcpRecoveryAttempts = mcpBudget.getSnapshot().recoveries;
        transitionExcelLifecycle(telemetry, "failed", reason);
      }
      void session?.abort().catch((error: unknown) => {
        if (telemetry) telemetry.errors.push(`Excel MCP budget abort failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    };

    try {
      const finishTool = defineTool("excel_finish", {
        description: "Complete the Excel request after the requested work is done. Use completed for locally fulfilled work, mcpCompleted when an unsupported requested operation required Excel MCP, needsClarification when workbook scope or matching criteria are ambiguous, and unsupported only when neither capability can represent the request.",
        parameters: completionSchema,
        handler: (value) => {
          const result = recordExcelCompletion(completionState, value);
          if (result.accepted && telemetry) recordExcelFinish(telemetry, value.status);
          return result.duplicate
            ? { ...result, message: "Completion was already recorded; continue the current SDK session if work remains." }
            : result;
        }
      });
      const requestMcpTool = defineTool("excel_request_mcp", {
        description: "Before using Excel MCP, declare one requested operation that the local capability catalog cannot represent and explain why. The runtime rejects declarations whose operation exactly matches a local capability ID. Do not use this to verify or repeat completed local work.",
        parameters: z.object({
          operation: z.string().trim().min(1).max(200),
          reason: z.string().trim().min(1).max(500)
        }),
        handler: ({ operation, reason }) => {
          if (!useMcp) return { eligible: false, reason: "Excel MCP is disabled for this validated local execution plan." };
          if (isLocalExcelCapabilityId(operation)) {
            return { eligible: false, reason: `The local capability ${operation} is already available; use its deterministic excel_* tool.` };
          }
          mcpEligibility = { operation, reason };
          return { eligible: true, operation, reason };
        }
      });
      session = await client.createSession({
        clientName: "oic-excel-expert",
        model: settings.model,
        workingDirectory: settings.repoRoot,
        configDirectory: settings.repoRoot,
        enableConfigDiscovery: false,
        instructionDirectories: [path.join(settings.repoRoot, ".github", "instructions")],
        skillDirectories: [path.join(settings.repoRoot, ".github", "skills")],
        disabledMcpServers: ["playwright"],
        ...(mcpServer ? { mcpServers: { [EXCEL_MCP_SERVER_NAME]: mcpServer } } : {}),
        tools: [...createExcelRuntimeTools(snapshot, { outputDirectory: stagingDirectory, onExecution: (execution) => { executions.push(execution); executionEvents.push("operation"); }, onExport: (execution) => { exports.push(execution); executionEvents.push("export"); } }), requestMcpTool, finishTool],
        availableTools: new ToolSet().addBuiltIn("task_complete").addCustom("*").addMcp("*"),
        toolSearch: EXCEL_NATIVE_TOOL_SEARCH_CONFIG,
        systemMessage: { mode: "append", content: buildSystemInstructions(snapshot, stagedFiles.map((file) => ({ name: file.fileName, path: file.relativePath })), clarificationHint, input.executionPlan) },
        hooks: {
          onPreToolUse: (hookInput) => {
            if (hookInput.toolName.startsWith("excel_")) return { permissionDecision: "allow" };
            const securityDenial = getExcelAgentMcpToolDenialReason(hookInput.toolName, hookInput.toolArgs, stagingDirectory, useMcp, mcpEligibility);
            if (securityDenial) {
              if (isExcelMcpToolName(hookInput.toolName) && telemetry) recordMcpToolDenied(telemetry, hookInput.toolName, securityDenial);
              return { permissionDecision: "deny", permissionDecisionReason: securityDenial };
            }
            if (isExcelMcpToolName(hookInput.toolName)) {
              const budgetDenial = mcpBudget.admit(abortForBudget);
              if (budgetDenial) {
                telemetry && (telemetry.mcpBudget = mcpBudget.getSnapshot());
                if (telemetry) telemetry.mcpRecoveryAttempts = mcpBudget.getSnapshot().recoveries;
                if (telemetry) recordMcpToolDenied(telemetry, hookInput.toolName, budgetDenial.reason);
                return {
                  permissionDecision: "deny",
                  permissionDecisionReason: "MCP_EXECUTION_BUDGET_EXHAUSTED",
                  additionalContext: `MCP_EXECUTION_BUDGET_EXHAUSTED\nreason: ${budgetDenial.code}\n${budgetDenial.reason}`
                };
              }
            }
            return { permissionDecision: "allow" };
          },
          onPostToolUse: (hookInput) => {
            if (isExcelMcpToolName(hookInput.toolName)) mcpToolsUsed.add(hookInput.toolName);
            const additionalContext = getExcelPostToolContext(hookInput.toolName);
            return additionalContext ? { additionalContext } : undefined;
          }
        }
      });
      if (runId) registerExcelCopilotSession(runId, session);
      telemetry = attachExcelSessionTelemetry(session, EXCEL_NATIVE_TOOL_SEARCH_CONFIG);
      telemetry.mcpBudget = mcpBudget.getSnapshot();
      transitionExcelLifecycle(telemetry, "executing", "Excel execution started");
      session.on((event) => {
        if (event.type === "tool.execution_start" && event.data.mcpServerName === EXCEL_MCP_SERVER_NAME) {
          mcpBudget.recordStart(event.data.toolCallId);
          telemetry!.mcpBudget = mcpBudget.getSnapshot();
        } else if (event.type === "tool.execution_complete") {
          const previous = mcpBudget.getSnapshot();
          mcpBudget.recordCompletion(event.data.toolCallId, event.data.success);
          const current = mcpBudget.getSnapshot();
          if (current.calls !== previous.calls || current.successes !== previous.successes || current.failures !== previous.failures) {
            telemetry!.mcpBudget = current;
            telemetry!.mcpRecoveryAttempts = current.recoveries;
            if (current.failures > previous.failures) {
              telemetry!.mcpRecoveryFailures ??= [];
              telemetry!.mcpRecoveryFailures.push(`Excel MCP tool failed${event.data.error?.message ? `: ${event.data.error.message.slice(0, 200)}` : "."}`);
            }
          }
        }
      });
      let mcpToolDiscovery: NonNullable<ExcelSessionTelemetry["mcpToolDiscovery"]> | undefined;
      if (mcpServer && options.captureMcpToolDiscovery) {
        mcpToolDiscovery = {
          serverName: EXCEL_MCP_SERVER_NAME,
          sessionId: session.sessionId,
          model: settings.model,
          errors: []
        };
        telemetry.mcpToolDiscovery = mcpToolDiscovery;
      }
      const maxNudges = Math.max(0, options.maxCompletionNudges ?? 1);
      const waitTimeoutMs = Number(process.env.OIC_RUNNER_ANALYSIS_TIMEOUT_MS) || 120000;
      let nudgeCount = 0;
      do {
        try {
          await session.sendAndWait({ prompt: nudgeCount === 0 ? `User request: ${prompt.trim()}` : "The Excel task is not complete. Continue the requested work and validate the result. If excel_finish has already recorded the final grounded result, leave the session idle; otherwise finish the remaining work first, then call excel_finish. task_complete may be emitted as optional telemetry.", mode: "immediate" }, waitTimeoutMs);
          telemetry.waitOutcome = telemetry.idleAborted ? "aborted" : "idle";
          if (telemetry.idleAborted) throw new Error("Excel Copilot session was aborted before validated completion.");
        } catch (error) {
          const budget = mcpBudget.getSnapshot();
          const failureKind = classifyExcelSessionWaitFailure(error, waitTimeoutMs, telemetry);
          telemetry.waitOutcome = failureKind;
          if (budget.deadlineAborted) {
            transitionExcelLifecycle(telemetry, "failed", budget.exhaustedReason);
            return { status: "unsupported", reason: budget.exhaustedReason ?? "Excel MCP time budget exhausted while a tool was running.", telemetry };
          }
          if (!canPreserveExcelCompletionAfterWaitFailure(completionState.completion, telemetry, failureKind)) {
            if (failureKind === "idleTimeout") {
              transitionExcelLifecycle(telemetry, "failed", error instanceof Error ? error.message : String(error));
              return { status: "unsupported", reason: error instanceof Error ? error.message : String(error), telemetry };
            }
            throw error;
          }
        }
        if (!options.autonomous || canAcceptInteractiveExcelCompletion(completionState.completion, telemetry)) break;
        nudgeCount += 1;
      } while (nudgeCount <= maxNudges);
      const budget = mcpBudget.getSnapshot();
      if (budget.deadlineAborted) {
        transitionExcelLifecycle(telemetry, "failed", budget.exhaustedReason);
        return { status: "unsupported", reason: budget.exhaustedReason ?? "Excel MCP time budget exhausted while a tool was running.", telemetry };
      }
      if (mcpToolDiscovery) {
        try {
          const toolsListResponse = await session.rpc.mcp.listTools({ serverName: EXCEL_MCP_SERVER_NAME });
          mcpToolDiscovery.toolsListResponse = toolsListResponse;
          mcpToolDiscovery.toolCount = toolsListResponse.tools.length;
          mcpToolDiscovery.toolNames = toolsListResponse.tools.map((tool) => tool.name);
          const currentMetadata = await session.rpc.tools.getCurrentMetadata();
          mcpToolDiscovery.currentSessionTools = currentMetadata.tools ?? [];
          mcpToolDiscovery.activeToolNames = (currentMetadata.tools ?? [])
            .filter((tool) => tool.mcpServerName === EXCEL_MCP_SERVER_NAME)
            .map((tool) => tool.mcpToolName ?? tool.name);
          if (mcpToolDiscovery.toolsListResponse && currentMetadata.tools) {
            const listedTools = (mcpToolDiscovery.toolsListResponse as { tools: Array<{ name: string; description?: string; ui?: unknown }> }).tools;
            mcpToolDiscovery.tools = addExcelMcpInputSchemas(
              listedTools,
              currentMetadata.tools,
              EXCEL_MCP_SERVER_NAME
            );
          }
        } catch (error) {
          mcpToolDiscovery.errors.push(`session tool schemas: ${error instanceof Error ? error.message : String(error)}`);
        }
        const diagnosticPath = path.join(paths.runtimeDataPath, `excel-mcp-tools-${session.sessionId}.json`);
        mcpToolDiscovery.diagnosticFile = diagnosticPath;
        try {
          await fs.writeFile(diagnosticPath, JSON.stringify(mcpToolDiscovery, null, 2), "utf8");
        } catch (error) {
          mcpToolDiscovery.errors.push(`diagnostic file: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const artifacts = await persistExcelArtifacts(stagingDirectory, stagedFiles.map((file) => file.absolutePath));
      const response = assembleResponse(snapshot, prompt, executions, exports, executionEvents, completionState.completion, completionState.acceptedCalls, mcpToolsUsed, artifacts, input.executionPlan, telemetry, options.autonomous === true);
      if (telemetry.waitOutcome === "idleTimeout" && response.status !== "unsupported") telemetry.completionAcceptedAfterIdleTimeout = true;
      if (response.status === "completed") transitionExcelLifecycle(telemetry, "completed", "validated Excel result accepted");
      else if (response.status === "needsClarification") transitionExcelLifecycle(telemetry, "clarification", "additional workbook scope is required");
      else if (response.status === "mcpCompleted") transitionExcelLifecycle(telemetry, "mcpRecovery", "completed through MCP fallback");
      else transitionExcelLifecycle(telemetry, "failed", response.reason);
      return response;
    } finally {
      mcpBudget.stop();
      await session?.disconnect().catch(() => undefined);
      await client.stop().catch(() => undefined);
      if (runId) unregisterExcelCopilotRun(runId);
    }
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
}

export function getExcelAgentMcpToolDenialReason(
  toolName: string,
  toolArgs: unknown,
  stagingDirectory: string,
  mcpEnabled: boolean,
  eligibility: { operation: string; reason: string } | undefined
): string | undefined {
  if (!mcpEnabled) return "MCP tools are disabled while executing a validated local Excel plan.";
  if (!eligibility) {
    return "Before Excel MCP, call excel_request_mcp with a specific requested operation absent from the local capability catalog and a concise reason.";
  }
  return getExcelMcpToolDenialReason(toolName, toolArgs, stagingDirectory);
}

export function buildSystemInstructions(snapshot: ExcelWorkbookSnapshot, stagedFiles: Array<{ name: string; path: string }>, clarificationHint?: string, executionPlan?: ExcelExecutionPlan): string {
  return [
    "You are Excel Expert running on the GitHub Copilot SDK. You own request interpretation, operation selection, sequencing, and deciding whether an unsupported capability is needed. Answer only from tool results; do not calculate, infer, or claim workbook facts from prompt or table context.",
    "Decompose the request into the operations it actually requires and compare each operation with the registry-derived local capability catalog below. Use one or more deterministic excel_* tools for every operation the catalog can represent. Multiple local steps do not justify MCP. Complete all representable work locally before considering MCP for a distinct unsupported operation.",
    "Use Excel MCP only for a clear requested operation that the local catalog cannot represent or whose listed limitations prevent. In a mixed request, use local tools for supported portions and MCP only for the unsupported portion; do not redo, re-export, or re-read completed local work through MCP merely to verify it. A successful local result does not itself create an unresolved need for MCP.",
    "Before any Excel MCP call, use excel_request_mcp to declare the specific unsupported requested operation and why the registry catalog cannot represent it. This gate is for capability expansion only, never verification. If the gate says an exact local capability ID is available, use the corresponding local tool instead.",
    "Deterministic result contract: local analysis operations return their kind and available facts, result table, and diagnostics; an export returns artifact status and output name. A result table's headers are its exact schema and its rows are the computed output; facts are authoritative. Never assume that a result table has presentation columns that were not returned.",
    "CSV, XLSX, or ZIP input and a request for XLSX output are not reasons to select MCP. The local parser handles supported inputs and excel_export_xlsx is the local XLSX export capability.",
    `Capability routes: ${JSON.stringify(getExcelCapabilityContracts())}`,
    `Local operation capability catalog (exact argument schemas are on the tools): ${JSON.stringify(getExcelOperationCapabilities().map(({ id, description, requiredInputs, optionalInputs, operators, aggregations, valueTypes, tableScope, rowScope, resultType, createsArtifact, limitations }) => ({ id, description, requiredInputs, optionalInputs, ...(operators ? { operators } : {}), ...(aggregations ? { aggregations } : {}), ...(valueTypes ? { valueTypes } : {}), tableScope, rowScope, resultType, createsArtifact, limitations })))}`,
    "excel_summarize accepts exactly one table. For a cross-file or cross-table total, call excel_summarize_multiple with a tables array; never pass an array to excel_summarize.",
    "After each deterministic operation, compare its result and diagnostics with the original request and all accumulated results. Stop and call excel_finish once every explicitly requested operation and output is satisfied, no unresolved error diagnostic remains, and no requested artifact step is pending. Do not add discovery, lookup, filter, validation, export, or MCP operations just to inspect, reshape, or verify an already sufficient result. Continue only for explicitly requested work that remains, or to safely repair a diagnostic that makes requested work incomplete; select any next operation from the original request and use only returned table headers and facts.",
    "MCP inputs and outputs are confined to the staged folder; writes, exports, and conversions are allowed there. Never run shell commands, Python, scripts, or custom code, and never access another path.",
    "For ambiguous identifiers, call the relevant deterministic tool and finish with needsClarification. Preserve exact identifier matching; do not silently use a prefix, suffix, or similarly named record.",
    "When the user asks to export, download, save, or put results into an Excel sheet, call excel_export_xlsx after the analysis tool using the exact generated result table name. Do not call excel_finish with completed until the XLSX export tool has succeeded.",
    clarificationHint ? `This request is missing required information. Call excel_finish exactly once with status needsClarification and this exact question: ${clarificationHint}` : undefined,
    "Completion protocol: after the grounded result is ready, call excel_finish exactly once and leave the session idle. The built-in task_complete event is optional telemetry for this interactive session; do not withhold a valid structured result when it is absent. If the request cannot be completed, call excel_finish with needsClarification or unsupported and explain the blocker. The first excel_finish call is authoritative; if a later turn repeats it, keep the first completion and continue the current session without treating the duplicate as a workbook failure.",
    executionPlan ? `Follow this ordered execution plan exactly. Do not add, skip, or reorder steps: ${JSON.stringify(executionPlan)}` : undefined,
    `Workbook profile: ${JSON.stringify(snapshot.profiles.map((profile) => ({
      ...profile,
      sampleRows: profile.sampleRows.slice(0, MAX_PROFILE_SAMPLE_ROWS)
    })))}`,
    `Staged MCP files: ${JSON.stringify(stagedFiles)}`
  ].filter((instruction): instruction is string => Boolean(instruction)).join("\n\n");
}

export function assembleResponse(snapshot: ExcelWorkbookSnapshot, prompt: string, executions: ExcelRuntimeToolExecution[], exports: ExcelRuntimeExportExecution[], executionEvents: Array<"operation" | "export">, completion: Completion | undefined, completionCalls: number, mcpToolsUsed: Set<string>, artifacts: import("../shared/types.js").ExcelArtifact[] = [], executionPlan?: ExcelExecutionPlan, telemetry?: import("../shared/types.js").ExcelSessionTelemetry, autonomous = false): ExcelPromptResponse {
  if (!completion) return { status: "unsupported", reason: "Excel Expert did not produce a structured completion.", telemetry };
  if (completionCalls !== 1) return { status: "unsupported", reason: `Excel Expert must call excel_finish exactly once; it called it ${completionCalls} times.`, telemetry };
  if (telemetry?.errors.length) return { status: "unsupported", reason: `Excel session failed: ${telemetry.errors[0]}`, telemetry };
  if (completion.status === "needsClarification") {
    return completion.questions?.length ? { status: "needsClarification", questions: completion.questions, explanation: completion.explanation, telemetry } : { status: "unsupported", reason: "Excel Expert requested clarification without a question.", telemetry };
  }
  if (completion.status === "unsupported") return { status: "unsupported", reason: completion.reason ?? "The request is not supported by the configured Excel capabilities.", telemetry };
  if (completion.status === "completed") {
    if (executions.length === 0) return { status: "unsupported", reason: "Excel Expert completed without a deterministic tool result.", telemetry };
    if (telemetry) transitionExcelLifecycle(telemetry, "validating", "checking plan, diagnostics, scope, and artifacts");
    const planError = validateExecutionPlan(executionPlan, executions, exports, executionEvents);
    const validationErrors = planError ? [planError] : [];
    if (/(?:export|download|save|excel\s+sheet)/i.test(prompt) && !artifacts.some((artifact) => artifact.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
      validationErrors.push("The request requires an XLSX export, but Excel Expert did not produce a downloadable workbook.");
    }
    const diagnostics = executions.flatMap((execution) => execution.result.diagnostics);
    const clarification = clarificationForDiagnostics(diagnostics, completion.explanation);
    if (clarification) {
      if (telemetry) recordExcelValidation(telemetry, false, ["diagnostics inspected"], ["requested row scope is unresolved"]);
      return { ...clarification, telemetry };
    }
    const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errorDiagnostics.length) validationErrors.push(`${errorDiagnostics.length} error diagnostic(s) remain after execution.`);
    if (telemetry) recordExcelValidation(telemetry, validationErrors.length === 0, [
      "execution plan conformance checked",
      "requested scope and diagnostics inspected",
      ...(exports.length ? ["export artifacts inspected"] : [])
    ], validationErrors);
    if (validationErrors.length) return { status: "unsupported", reason: validationErrors.join(" "), telemetry };
    const analysis = buildLocalAnalysis(snapshot, executions);
    return { status: "completed", analysis, explanation: completion.explanation, ...(artifacts.length ? { artifacts } : {}), telemetry };
  }
  if (mcpToolsUsed.size === 0 || !completion.answer || !completion.files?.length || !completion.provenance) {
    return { status: "unsupported", reason: "Excel Expert reported MCP completion without verified MCP provenance.", telemetry };
  }
  return {
    status: "mcpCompleted",
    answer: completion.answer,
    source: "mbeps/excel-mcp",
    files: completion.files,
    artifacts,
    toolsUsed: [...mcpToolsUsed],
    provenance: completion.provenance,
    localVerification: "not-performed",
    ...(executions.length ? { localAnalysis: buildLocalAnalysis(snapshot, executions) } : {}),
    telemetry
  };
}

function buildLocalAnalysis(snapshot: ExcelWorkbookSnapshot, executions: ExcelRuntimeToolExecution[]): ExcelAnalysisResult {
  const finalExecution = executions.at(-1);
  return {
    tables: finalExecution?.result.table ? [compactResponseTable(finalExecution.result.table)] : [],
    operations: executions.map((execution) => ({
      ...execution.result,
      ...(execution.result.table ? { table: compactResponseTable(execution.result.table) } : {})
    })),
    diagnostics: [...snapshot.diagnostics, ...executions.flatMap((execution) => execution.result.diagnostics)]
  };
}

function compactResponseTable(table: ExcelAnalysisResult["tables"][number]): ExcelAnalysisResult["tables"][number] {
  return { ...table, rows: table.rows.slice(0, MAX_RESPONSE_ROWS_PER_TABLE) };
}

function clarificationForDiagnostics(diagnostics: ExcelDiagnostic[], explanation?: string): ExcelPromptResponse | undefined {
  const diagnostic = diagnostics.find((entry) => entry.code === "ROW_NOT_FOUND" || entry.code === "MULTIPLE_ROWS_FOUND");
  if (!diagnostic) return undefined;
  return {
    status: "needsClarification",
    questions: [diagnostic.code === "ROW_NOT_FOUND"
      ? `${diagnostic.message} Please confirm the exact identifier before I compare the requested fields.`
      : `${diagnostic.message} Please provide a more specific identifier or confirm that all matching rows should be checked.`],
    explanation
  };
}

export function validateExecutionPlan(plan: ExcelExecutionPlan | undefined, executions: ExcelRuntimeToolExecution[], exports: ExcelRuntimeExportExecution[], executionEvents: Array<"operation" | "export">): string | undefined {
  if (!plan) return undefined;
  if (plan.steps.length === 0) return "Excel Expert received an empty execution plan.";
  if (plan.steps.some((step) => step.capability !== "local-registry")) return "Excel Expert attempted to execute a non-local capability in a local plan.";
  if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length) return "Excel Expert received an execution plan with duplicate step ids.";
  const expectedSteps = plan.steps.filter((step) => step.operation || step.export);
  const expectedEvents = expectedSteps.map((step) => step.operation ? "operation" : "export");
  if (expectedEvents.length !== executionEvents.length || expectedEvents.some((event, index) => event !== executionEvents[index])) {
    return `Excel Expert did not complete the ordered execution plan. Expected events: ${expectedEvents.join(", ")}; actual events: ${executionEvents.join(", ")}.`;
  }
  const expectedOperations = expectedSteps.filter((step) => step.operation).map((step) => step.operation!);
  const actualOperations = executions;
  if (expectedOperations.length !== actualOperations.length || expectedOperations.some((operation, index) => {
    const actual = actualOperations[index];
    return operation.kind !== actual.kind
      || operation.inputTable !== actual.inputTable
      || !sameJson(operation.options, actual.options);
  })) {
    return `Excel Expert did not complete the planned operations. Expected kinds: ${expectedOperations.map((operation) => operation.kind).join(", ")}; actual kinds: ${actualOperations.map((operation) => operation.kind).join(", ")}.`;
  }
    const expectedExports = plan.steps.filter((step) => step.export);
    if (exports.length !== expectedExports.length) return "Excel Expert did not complete the required export steps.";
    if (expectedExports.some((step, index) => {
      const actual = exports[index];
      return !actual || step.export?.format !== "xlsx" || (step.export.fileName !== undefined && step.export.fileName !== actual.fileName);
    })) return "Excel Expert did not complete the planned export configuration.";
  return undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
