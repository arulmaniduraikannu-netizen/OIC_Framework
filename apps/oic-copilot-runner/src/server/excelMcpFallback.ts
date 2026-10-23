import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ToolSet } from "@github/copilot-sdk";
import type { MCPServerConfig } from "@github/copilot-sdk";
import { createCopilotClient } from "./copilotRunner.js";
import { paths, settings } from "./config.js";
import { registerExcelCopilotClient, registerExcelCopilotSession, unregisterExcelCopilotRun, type ExcelCopilotRunOptions } from "./excelCopilotRuntime.js";
import { readUploadedFile, type UploadedFile } from "./uploadedFile.js";
import { persistExcelArtifacts } from "./excelArtifactStore.js";
import { attachExcelSessionTelemetry, classifyExcelSessionWaitFailure, ExcelSessionWaitError, EXCEL_NATIVE_TOOL_SEARCH_CONFIG, recordMcpToolDenied, transitionExcelLifecycle } from "./excelSessionTelemetry.js";
import { ExcelMcpExecutionBudget, isExcelMcpToolName } from "./excelMcpExecutionBudget.js";

const MBEPS_EXCEL_MCP_COMMIT = "3439a8540c50cd9620e2c3d538fcb799ed88b72d";
const MAX_STAGED_FILES = 20;
const CORE_EXCEL_TOOLS = [
  "get_workbook_metadata",
  "get_sheet_summary",
  "read_cells",
  "column_statistics",
  "aggregate_data",
  "find_duplicates",
  "profile_data",
  "value_counts",
  "formula_audit",
  "multi_file",
  "csv_ops"
];
const EXCEL_MCP_SERVER_NAME = "excel-mcp";
const BLOCKED_TOOL_PARTS = new Set(["command", "exec", "execute", "python", "shell", "script", "subprocess", "terminal", "code"]);

export function buildExcelMcpServerConfig(config: unknown, stagingDirectory: string): MCPServerConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Workspace MCP configuration must be an object.");
  }
  const servers = (config as { servers?: unknown }).servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("Workspace MCP configuration has no servers object.");
  }
  const configuredServer = (servers as Record<string, unknown>)[EXCEL_MCP_SERVER_NAME];
  if (!configuredServer || typeof configuredServer !== "object" || Array.isArray(configuredServer)) {
    throw new Error("Add the pinned excel-mcp server to .vscode/mcp.json before running the Excel MCP fallback.");
  }
  const server = configuredServer as { command?: unknown; args?: unknown; type?: unknown; tools?: unknown };
  if (server.command !== "uvx" || !Array.isArray(server.args) || !server.args.every((argument) => typeof argument === "string")) {
    throw new Error("The excel-mcp workspace entry must use the configured local uvx command and string arguments.");
  }
  if (server.type !== undefined && server.type !== "stdio" && server.type !== "local") {
    throw new Error("The Excel MCP fallback requires the configured local stdio server.");
  }
  if (!server.args.some((argument) => argument.includes(`@${MBEPS_EXCEL_MCP_COMMIT}`))) {
    throw new Error("The excel-mcp workspace entry must use the reviewed pinned commit.");
  }
  if (!Array.isArray(server.tools) || !server.tools.includes("*")) {
    throw new Error("The excel-mcp workspace entry must advertise tools for session discovery; execution remains guarded by the staged Excel MCP pre-tool policy.");
  }
  return {
    command: server.command,
    args: [...server.args],
    type: "stdio",
    tools: server.tools.filter((tool): tool is string => typeof tool === "string"),
    workingDirectory: stagingDirectory
  };
}

export function buildExcelMcpAvailableTools(): ToolSet {
  return new ToolSet().addMcp("*");
}

export interface ExcelMcpInputFile extends Partial<UploadedFile> {
  fileName: string;
  contentBase64?: string;
}

export interface ExcelMcpTableProvenance {
  sourceFile: string;
  tableName: string;
  columns: string[];
}

export interface ExcelMcpProvenance {
  sourceFiles: string[];
  tables: ExcelMcpTableProvenance[];
}

export interface ExcelMcpFallbackResult {
  answer: string;
  files: string[];
  artifacts?: import("../shared/types.js").ExcelArtifact[];
  toolsUsed: string[];
  provenance: ExcelMcpProvenance;
  telemetry?: import("../shared/types.js").ExcelSessionTelemetry;
  copilot?: {
    runId: string;
    sessionId: string;
    model: string;
    mcpServers: string[];
    toolsUsed: string[];
  };
}

export interface StagedExcelFile {
  fileName: string;
  relativePath: string;
  absolutePath: string;
}

export async function runExcelMcpFallback(files: ExcelMcpInputFile[], prompt: string, options: ExcelCopilotRunOptions = {}): Promise<ExcelMcpFallbackResult> {
  await fs.mkdir(paths.runtimeDataPath, { recursive: true });
  const stagingDirectory = await fs.mkdtemp(path.join(paths.runtimeDataPath, "excel-mcp-fallback-"));
  try {
    const stagedFiles = await stageExcelFallbackInputs(files, stagingDirectory);
    return await runExcelMcpSession(stagedFiles, stagingDirectory, prompt, options);
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
}

export async function stageExcelFallbackInputs(files: ExcelMcpInputFile[], stagingDirectory: string): Promise<StagedExcelFile[]> {
  const staged: StagedExcelFile[] = [];
  let sequence = 0;

  async function writeFile(fileName: string, content: Uint8Array): Promise<void> {
    if (staged.length >= MAX_STAGED_FILES) {
      throw new Error(`Excel MCP fallback supports at most ${MAX_STAGED_FILES} staged files.`);
    }
    const extension = path.extname(fileName).toLowerCase();
    if (extension !== ".csv" && extension !== ".xlsx") {
      return;
    }
    const safeName = path.basename(fileName).replace(/[^a-z0-9._-]/gi, "_") || `workbook${extension}`;
    const relativePath = `${String(++sequence).padStart(3, "0")}-${safeName}`;
    const absolutePath = path.join(stagingDirectory, relativePath);
    await fs.writeFile(absolutePath, content);
    staged.push({ fileName: safeName, relativePath, absolutePath });
  }

  async function expandFile(fileName: string, content: Uint8Array): Promise<void> {
    const extension = path.extname(fileName.split("#").at(-1) ?? fileName).toLowerCase();
    if (extension === ".zip") {
      const zip = await JSZip.loadAsync(content);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && [".csv", ".xlsx"].includes(path.extname(entry.name).toLowerCase()));
      if (entries.length === 0) {
        throw new Error(`${fileName}: ZIP contains no .csv or .xlsx files for Excel MCP fallback.`);
      }
      for (const entry of entries) {
        await writeFile(path.basename(entry.name), await entry.async("uint8array"));
      }
      return;
    }
    await writeFile(fileName, content);
  }

  for (const file of files) {
    const content = "filePath" in file && file.filePath
      ? await readUploadedFile(file as UploadedFile)
      : Buffer.from(file.contentBase64 ?? "", "base64");
    await expandFile(file.fileName, content);
  }
  if (staged.length === 0) {
    throw new Error("Excel MCP fallback requires at least one CSV or XLSX file.");
  }
  return staged;
}

export function getExcelMcpToolDenialReason(toolName: string, toolArgs: unknown, stagingDirectory: string): string | undefined {
  if (!isAllowedExcelMcpToolName(toolName)) {
    return "The Excel fallback session may call only configured Excel MCP tools; shell, Python, and custom-code execution are denied.";
  }
  if (typeof toolArgs === "string") {
    try {
      toolArgs = JSON.parse(toolArgs) as unknown;
    } catch {
      return "Excel MCP tool arguments must be valid JSON.";
    }
  }
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return "Excel MCP tool arguments must be an object.";
  }
  const args = toolArgs as Record<string, unknown>;
  if (toolName.toLowerCase().endsWith("csv_ops")) {
    if (typeof args.file_path !== "string" || !args.file_path.trim()) {
      return "Excel MCP CSV operations require a staged file_path.";
    }
  }

  const pathsToCheck: string[] = [];
  const collectPaths = (value: unknown): void => {
    if (typeof value === "string") {
      pathsToCheck.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collectPaths);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collectPaths);
    }
  };
  const visit = (value: unknown, key = ""): void => {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const keyParts = normalizedKey.split(/[^a-z0-9]+/).filter(Boolean);
    if (keyParts.some((part) => ["file", "files", "filename", "filenames", "path", "paths"].includes(part))) {
      collectPaths(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(toolArgs);

  if (pathsToCheck.length === 0) {
    return "Excel MCP calls must identify an input or output path inside the staged upload folder.";
  }

  const root = path.resolve(stagingDirectory);
  const escapedPath = pathsToCheck.find((candidate) => {
    if (!candidate.trim()) return true;
    const resolved = path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  });
  return escapedPath === undefined ? undefined : "Excel MCP calls may access only files staged for this request.";
}

function isAllowedExcelMcpToolName(toolName: string): boolean {
  const normalizedToolName = toolName.toLowerCase();
  const toolParts = normalizedToolName.split(/[_:/-]+/).filter(Boolean);
  if (toolParts.some((part) => BLOCKED_TOOL_PARTS.has(part))) {
    return false;
  }
  const isExcelMcpTool = normalizedToolName === EXCEL_MCP_SERVER_NAME
    || normalizedToolName.startsWith(`${EXCEL_MCP_SERVER_NAME}_`)
    || normalizedToolName.startsWith(`${EXCEL_MCP_SERVER_NAME}-`)
    || normalizedToolName.startsWith(`${EXCEL_MCP_SERVER_NAME}/`)
    || normalizedToolName.startsWith(`mcp__${EXCEL_MCP_SERVER_NAME}__`);
  return isExcelMcpTool || CORE_EXCEL_TOOLS.some((allowedTool) =>
    normalizedToolName === allowedTool
  );
}

function safeToolName(toolName: string): string {
  return toolName.replace(/[^a-z0-9_.:/-]/gi, "").slice(0, 80) || "unknown-tool";
}

async function runExcelMcpSession(stagedFiles: StagedExcelFile[], stagingDirectory: string, userPrompt: string, options: ExcelCopilotRunOptions): Promise<ExcelMcpFallbackResult> {
  const client = await createCopilotClient();
  const runId = options.runId;
  if (runId) {
    registerExcelCopilotClient(runId, client);
  }
  const toolsUsed = new Set<string>();
  const serverStatuses = new Set<string>();
  const toolDenials = new Set<string>();
  const advertisedTools = new Set<string>();
  let latestAssistantAnswer = "";
  let latestSuccessfulMcpResult = "";
  let toolListError = "";
  try {
    const workspaceMcpConfig = JSON.parse(await fs.readFile(settings.mcpConfigPath, "utf8")) as unknown;
    const mcpServer = buildExcelMcpServerConfig(workspaceMcpConfig, stagingDirectory);
    const mcpBudget = new ExcelMcpExecutionBudget();
    let telemetry: import("../shared/types.js").ExcelSessionTelemetry | undefined;
    let abortSession: (() => Promise<void>) | undefined;
    const abortForBudget = (reason: string): void => {
      if (telemetry) {
        telemetry.mcpBudget = mcpBudget.getSnapshot();
        telemetry.mcpRecoveryAttempts = mcpBudget.getSnapshot().recoveries;
        transitionExcelLifecycle(telemetry, "failed", reason);
      }
      void abortSession?.().catch((error: unknown) => {
        if (telemetry) telemetry.errors.push(`Excel MCP budget abort failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const session = await client.createSession({
      clientName: "oic-excel-mcp-fallback",
      model: settings.model,
      workingDirectory: settings.repoRoot,
      configDirectory: settings.repoRoot,
      enableConfigDiscovery: true,
      disabledMcpServers: ["playwright"],
      mcpServers: { [EXCEL_MCP_SERVER_NAME]: mcpServer },
      availableTools: buildExcelMcpAvailableTools().addBuiltIn("task_complete"),
      toolSearch: EXCEL_NATIVE_TOOL_SEARCH_CONFIG,
      hooks: {
        onPreToolUse: (input) => {
          const denialReason = getExcelMcpToolDenialReason(input.toolName, input.toolArgs, stagingDirectory);
          if (denialReason) {
            toolDenials.add(`${safeToolName(input.toolName)}: ${denialReason}`);
            if (isExcelMcpToolName(input.toolName) && telemetry) recordMcpToolDenied(telemetry, input.toolName, denialReason);
            return { permissionDecision: "deny", permissionDecisionReason: denialReason };
          }
          if (isExcelMcpToolName(input.toolName)) {
            const budgetDenial = mcpBudget.admit(abortForBudget);
            if (budgetDenial) {
              toolDenials.add(`${safeToolName(input.toolName)}: ${budgetDenial.code}`);
              telemetry && (telemetry.mcpBudget = mcpBudget.getSnapshot());
              if (telemetry) telemetry.mcpRecoveryAttempts = mcpBudget.getSnapshot().recoveries;
              if (telemetry) recordMcpToolDenied(telemetry, input.toolName, budgetDenial.reason);
              return {
                permissionDecision: "deny",
                permissionDecisionReason: "MCP_EXECUTION_BUDGET_EXHAUSTED",
                additionalContext: `MCP_EXECUTION_BUDGET_EXHAUSTED\nreason: ${budgetDenial.code}\n${budgetDenial.reason}`
              };
            }
          }
          return { permissionDecision: "allow" };
        },
        onPostToolUse: (input) => {
          if (isAllowedExcelMcpToolName(input.toolName)) {
            toolsUsed.add(safeToolName(input.toolName));
            const result = input.toolResult as { content?: unknown; detailedContent?: unknown };
            latestSuccessfulMcpResult = typeof result.detailedContent === "string"
              ? result.detailedContent.trim()
              : typeof result.content === "string"
                ? result.content.trim()
                : "";
          }
        }
      }
    });
    abortSession = () => session.abort();
    if (runId) {
      registerExcelCopilotSession(runId, session);
    }
    telemetry = attachExcelSessionTelemetry(session, EXCEL_NATIVE_TOOL_SEARCH_CONFIG);
    telemetry.mcpBudget = mcpBudget.getSnapshot();
    telemetry.mcpToolDiscovery = {
      serverName: EXCEL_MCP_SERVER_NAME,
      sessionId: session.sessionId,
      model: settings.model,
      errors: []
    };
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
    try {
      try {
        const listedTools = await session.rpc.mcp.listTools({ serverName: "excel-mcp" });
        listedTools.tools.forEach((tool) => advertisedTools.add(safeToolName(tool.name)));
        telemetry.mcpToolDiscovery.toolCount = listedTools.tools.length;
        telemetry.mcpToolDiscovery.toolNames = listedTools.tools.map((tool) => tool.name);
        const currentMetadata = await session.rpc.tools.getCurrentMetadata();
        telemetry.mcpToolDiscovery.activeToolNames = (currentMetadata.tools ?? [])
          .filter((tool) => tool.mcpServerName === EXCEL_MCP_SERVER_NAME)
          .map((tool) => tool.mcpToolName ?? tool.name);
      } catch (error) {
        toolListError = error instanceof Error ? error.message.replace(/[^a-z0-9 _:/.-]/gi, "").slice(0, 160) : "MCP tool listing failed.";
        telemetry.mcpToolDiscovery.errors.push(toolListError);
      }
      session.on((event) => {
        if (event.type === "session.mcp_servers_loaded") {
          event.data.servers.forEach((server) => serverStatuses.add(`${server.name}:${server.status}`));
        } else if (event.type === "session.mcp_server_status_changed") {
          serverStatuses.add(`${event.data.serverName}:${event.data.status}`);
        } else if (event.type === "assistant.message") {
          latestAssistantAnswer = event.data.content?.trim() ?? "";
        }
      });
      const stagedFileList = stagedFiles.map((file) => ({ name: file.fileName, path: file.relativePath }));
      const basePrompt = [
        "The deterministic local Excel operation catalog could not represent this clear request. Use the configured Excel MCP tools to complete the request for all relevant staged files and worksheets.",
        "You must finish the user's requested result, not merely report intermediate per-sheet or per-file values. For totals, counts, comparisons, or aggregations across multiple files or sheets, collect every required result and calculate the final combined answer.",
        "Choose the MCP tool whose schema matches the request. If a tool call fails, inspect the actual error and use a different supported staged Excel MCP strategy when it can recover the requested result. The runtime enforces request-wide call, recovery, consecutive-failure, and elapsed-time budgets.",
        "Use tool definitions and schemas made available by the Copilot SDK; do not invent tool names or arguments.",
        "You may modify, export, or convert workbooks only when every input and output path is inside the staged upload folder. Do not run shell commands, Python, scripts, or custom code, and do not access any other path.",
        "Ground every factual answer in MCP tool results. Identify the source filename and sheet/columns used when available. If the tools cannot establish an exact answer after trying the available staged strategies, explain the specific blocker.",
        "After the requested answer is grounded and complete, call task_complete with success true. If the request cannot be completed, call task_complete with success false and explain the blocker.",
        "Keep the final answer concise: provide the requested final totals or findings and a short source summary, not full table contents or row dumps.",
        "Excel MCP file paths must be the relative paths shown in the staged file list.",
        `Staged files: ${JSON.stringify(stagedFileList)}`,
        `User request: ${userPrompt.trim()}`
      ].join("\n");
      let answer = "";
      transitionExcelLifecycle(telemetry, "mcpRecovery", "Copilot SDK selected the unsupported Excel capability");
      let result: Awaited<ReturnType<typeof session.sendAndWait>> | undefined;
      const waitTimeoutMs = Number(process.env.OIC_RUNNER_ANALYSIS_TIMEOUT_MS) || 120000;
      try {
        result = await session.sendAndWait({ prompt: basePrompt, mode: "immediate" }, waitTimeoutMs);
        telemetry.waitOutcome = telemetry.idleAborted ? "aborted" : "idle";
        if (telemetry.idleAborted) throw new Error("Excel MCP Copilot session was aborted before validated completion.");
      } catch (error) {
        const budget = mcpBudget.getSnapshot();
        const failureKind = classifyExcelSessionWaitFailure(error, waitTimeoutMs, telemetry);
        telemetry.waitOutcome = failureKind;
        if (budget.deadlineAborted) throw new Error(budget.exhaustedReason ?? "Excel MCP time budget exhausted while a tool was running.");
        const recoveredAnswer = latestAssistantAnswer.trim() || latestSuccessfulMcpResult.trim();
        const canRecoverFromMissingIdle = canRecoverExcelMcpResponseAfterWaitFailure(
          recoveredAnswer,
          mcpBudget.getSnapshot().successes,
          failureKind,
          telemetry
        );
        if (!canRecoverFromMissingIdle) {
          if (failureKind === "idleTimeout") {
            const message = error instanceof Error ? error.message : String(error);
            transitionExcelLifecycle(telemetry, "failed", message);
            throw new ExcelSessionWaitError(message, telemetry);
          }
          throw error;
        }
        answer = recoveredAnswer;
        telemetry.mcpRecoveryFailures ??= [];
        telemetry.mcpRecoveryFailures.push(`Completed through successful MCP tool evidence without session.idle: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!answer) answer = result?.data.content?.trim() || latestAssistantAnswer.trim() || latestSuccessfulMcpResult.trim();
      telemetry.mcpBudget = mcpBudget.getSnapshot();
      telemetry.mcpRecoveryAttempts = mcpBudget.getSnapshot().recoveries;
      const budget = mcpBudget.getSnapshot();
      if (budget.deadlineAborted) throw new Error(budget.exhaustedReason ?? "Excel MCP time budget exhausted while a tool was running.");
      if (!answer) {
        throw new Error("Copilot + Excel MCP returned no analysis text.");
      }
      if (needsMcpRecovery(answer)) {
        throw new Error("Copilot + Excel MCP could not complete the requested analysis within the bounded MCP execution policy.");
      }
      if (telemetry.errors.length) {
        throw new Error(`Excel MCP session failed: ${telemetry.errors[0]}`);
      }
      if (toolsUsed.size === 0) {
        const status = [...serverStatuses].join(", ") || "no MCP server status event received";
        const denials = [...toolDenials].join("; ") || "no pre-tool denial recorded";
        const available = [...advertisedTools].join(", ") || "no tools advertised";
        const listing = toolListError || "tool list request succeeded";
        throw new Error(`Excel MCP produced no completed tool calls (server status: ${status}; ${listing}; available tools: ${available}; denials: ${denials}).`);
      }
      const files = stagedFiles.map((file) => file.fileName);
      telemetry.applicationCompletionRecorded = true;
      const artifacts = await persistExcelArtifacts(stagingDirectory, stagedFiles.map((file) => file.absolutePath), {
        comparisonOnly: /\bcompar(?:e|ison)|\bmatch(?:ing|ed)?\b/i.test(userPrompt)
      });
      if (telemetry.waitOutcome === "idleTimeout") telemetry.completionAcceptedAfterIdleTimeout = true;
      return {
        answer,
        files,
        artifacts,
        toolsUsed: [...toolsUsed],
        provenance: { sourceFiles: files, tables: [] },
        telemetry,
        copilot: runId ? {
          runId,
          sessionId: session.sessionId,
          model: settings.model,
          mcpServers: [...serverStatuses],
          toolsUsed: [...toolsUsed]
        } : undefined
      };
    } finally {
      mcpBudget.stop();
      await session.disconnect().catch(() => undefined);
    }
  } finally {
    await client.stop().catch(() => undefined);
    if (runId) {
      unregisterExcelCopilotRun(runId);
    }
  }
}

export function isMcpCompletionRecoverable(answer: string, successfulMcpToolCalls: number): boolean {
  return Boolean(answer.trim()) && successfulMcpToolCalls > 0 && !needsMcpRecovery(answer);
}

export function canRecoverExcelMcpResponseAfterWaitFailure(
  answer: string,
  successfulMcpToolCalls: number,
  failureKind: import("../shared/types.js").ExcelSessionWaitOutcome,
  telemetry: import("../shared/types.js").ExcelSessionTelemetry
): boolean {
  return failureKind === "idleTimeout"
    && telemetry.errors.length === 0
    && !telemetry.idleAborted
    && !telemetry.mcpBudget?.deadlineAborted
    && isMcpCompletionRecoverable(answer, successfulMcpToolCalls);
}

function needsMcpRecovery(answer: string): boolean {
  return /\b(cannot|can't|could not|unable|failed|failure|rejected|not available|not supported|no exact answer)\b/i.test(answer);
}