export type AutomationStatus = "ready" | "queued" | "running" | "generated" | "validated" | "passed" | "failed" | "blocked" | "cancelled";

export interface WorkbookSummary {
  workbookPath: string;
  workbookId?: string;
  sheets: SheetSummary[];
  testCases: NormalizedTestCase[];
}

export interface WorkbookDescriptor {
  id: string;
  name: string;
  path: string;
  source: "default" | "uploaded";
  uploadedAt?: string;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  headers: string[];
}

export interface NormalizedTestCase {
  id: string;
  title: string;
  feature: string;
  priority: string;
  preconditions: string;
  steps: string[];
  expectedResult: string;
  sourceWorkbook: string;
  sheetName: string;
  rowNumber: number;
  raw: Record<string, string>;
}

export interface RunnerJob {
  id: string;
  status: AutomationStatus;
  testCase: NormalizedTestCase;
  runProfile: RunProfile;
  model?: string;
  createdAt: string;
  updatedAt: string;
  phase: string;
  log: string[];
  artifacts: RunnerArtifact[];
  usage?: RunnerUsage;
}

export interface RunnerUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  aiCreditsUsed?: number;
  premiumRequestCost?: number;
  reported: boolean;
}

export interface RunnerArtifact {
  label: string;
  path: string;
  kind: "generated-file" | "validation" | "test-result" | "trace" | "screenshot" | "log" | "report";
}

export interface RunnerSettings {
  repoRoot: string;
  workbookPath: string;
  appDataPath: string;
  runtimeDataPath: string;
  mcpConfigPath: string;
  model: string;
}

export interface RunProfile {
  portalUrl: string;
  tenantName: string;
  username: string;
  storageStatePath: string;
  notes: string;
}

export type ExcelValue =
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; value: Date; format?: string }
  | { kind: "datetime"; value: Date; format?: string }
  | { kind: "blank"; value: null };

/** Primitive operation value with optional XLSX date semantics retained. */
export type ExcelCell = string | number | boolean | null | ExcelValue;

export type ExcelRow = Record<string, ExcelCell>;

export interface ExcelTable {
  name: string;
  headers: string[];
  rows: ExcelRow[];
  sourceFile?: string;
}

export interface ExcelWorkbookSnapshot {
  files: string[];
  tables: ExcelTable[];
  profiles: ExcelTableProfile[];
  diagnostics: ExcelDiagnostic[];
}

export type ExcelColumnType = "blank" | "text" | "number" | "boolean" | "date" | "mixed";
export type ExcelValueKind = "string" | "number" | "boolean" | "date" | "datetime" | "blank";

export interface ExcelTableProfile {
  name: string;
  sourceFile?: string;
  rowCount: number;
  headers: string[];
  sampleRows: ExcelRow[];
  columnTypes: Record<string, ExcelColumnType>;
  candidateKeys: string[];
}

export type ExcelDiagnosticSeverity = "info" | "warning" | "error";

export interface ExcelDiagnostic {
  severity: ExcelDiagnosticSeverity;
  code: string;
  message: string;
  tableName?: string;
  rowNumber?: number;
  columnName?: string;
}

export type ExcelOperationKind = "discover" | "filter" | "lookup" | "group" | "summarize" | "summarizeMultiple" | "compare" | "compareVersions" | "compareRows" | "checkValues" | "validate";

export interface ExcelOperationSpec {
  id: string;
  kind: ExcelOperationKind;
  inputTable?: string;
  options: Record<string, unknown>;
}

export interface ExcelOperationCapability {
  id: ExcelOperationKind | "exportXlsx";
  description: string;
  requiredInputs: string[];
  optionalInputs: string[];
  operators?: string[];
  aggregations?: string[];
  valueTypes?: ExcelValueKind[];
  tableScope: "none" | "one" | "multiple" | "two";
  rowScope: "wholeTable" | "allRows" | "boundedRows" | "selectedRows";
  resultType: "metadata" | "table" | "diagnostics" | "table-and-facts" | "artifact";
  createsArtifact: boolean;
  limitations: string[];
}

export interface ExcelAnalysisPlan {
  operations: ExcelOperationSpec[];
}

export interface ExcelExportSpec {
  format: "xlsx";
  fileName?: string;
}

export type ExcelCapabilityId = "local-registry" | "excel-mcp";

export interface ExcelExecutionStep {
  id: string;
  capability: ExcelCapabilityId;
  operation?: ExcelOperationSpec;
  export?: ExcelExportSpec;
}

export interface ExcelExecutionPlan {
  steps: ExcelExecutionStep[];
}

export interface ExcelCapabilityContract {
  id: ExcelCapabilityId;
  description: string;
  operationKinds?: ExcelOperationKind[];
  deterministic: boolean;
  readOnly: boolean;
  localVerification: "performed" | "not-performed";
  clarificationRequired: boolean;
}

export type ExcelPromptPlan =
  | { status: "ready"; operations: ExcelOperationSpec[]; export?: ExcelExportSpec; executionPlan?: ExcelExecutionPlan; capability?: "local-registry"; explanation?: string; telemetry?: ExcelSessionTelemetry }
  | { status: "needsClarification"; questions: string[]; explanation?: string; telemetry?: ExcelSessionTelemetry }
  | { status: "mcp"; reason: string; capability?: "excel-mcp"; telemetry?: ExcelSessionTelemetry }
  | { status: "unsupported"; reason: string; telemetry?: ExcelSessionTelemetry };

export interface ExcelOperationResult {
  operationId: string;
  kind: ExcelOperationKind;
  table?: ExcelTable;
  facts: Record<string, ExcelCell | ExcelCell[]>;
  diagnostics: ExcelDiagnostic[];
}

export interface ExcelAnalysisResult {
  tables: ExcelTable[];
  operations: ExcelOperationResult[];
  diagnostics: ExcelDiagnostic[];
}

export type ExcelPromptResponse =
  | { status: "completed"; analysis: ExcelAnalysisResult; explanation?: string; artifacts?: ExcelArtifact[]; telemetry?: ExcelSessionTelemetry }
  | { status: "needsClarification"; questions: string[]; explanation?: string; telemetry?: ExcelSessionTelemetry }
  | { status: "mcpCompleted"; answer: string; source: "mbeps/excel-mcp"; files: string[]; artifacts: ExcelArtifact[]; toolsUsed: string[]; provenance: { sourceFiles: string[]; tables: Array<{ sourceFile: string; tableName: string; columns: string[] }> }; localVerification: "not-performed"; localAnalysis?: ExcelAnalysisResult; telemetry?: ExcelSessionTelemetry; copilot?: { runId: string; sessionId: string; model: string; mcpServers: string[]; toolsUsed: string[] } }
  | { status: "unsupported"; reason: string; telemetry?: ExcelSessionTelemetry };

export interface ExcelAnalysisReport {
  fileName: string;
  markdown: string;
  csv: string;
}

export interface ExcelArtifact {
  id: string;
  fileName: string;
  mimeType: string;
  downloadUrl: string;
}

export interface ExcelSessionTelemetry {
  sessionId: string;
  turns: number;
  turnIds: string[];
  toolCalls: number;
  idle: boolean;
  idleAborted?: boolean;
  errors: string[];
  toolFailures?: string[];
  taskComplete: boolean;
  applicationCompletionRecorded?: boolean;
  excelFinishRecorded?: boolean;
  excelFinishStatus?: string;
  waitOutcome?: ExcelSessionWaitOutcome;
  completionAcceptedAfterIdleTimeout?: boolean;
  taskCompleteSuccess?: boolean;
  taskCompleteSummary?: string;
  taskCompleteReason?: string;
  eventTypes: string[];
  lifecycleState?: ExcelLifecycleState;
  lifecycleTransitions?: ExcelLifecycleTransition[];
  validation?: ExcelValidationTelemetry;
  mcpRecoveryAttempts?: number;
  mcpRecoveryFailures?: string[];
  mcpBudget?: ExcelMcpBudgetTelemetry;
  mcpToolLifecycle?: ExcelMcpToolLifecycleTelemetry;
  nativeToolSearch?: {
    enabled: boolean;
    deferThreshold?: number;
    invocationCount: number;
    mcpCapabilitiesUsedAfterSearch: string[];
  };
  mcpCapabilitiesExecuted?: string[];
  mcpToolFailures?: string[];
  mcpToolDiscovery?: {
    serverName: string;
    sessionId: string;
    model: string;
    toolCount?: number;
    toolNames?: string[];
    activeToolNames?: string[];
    toolsListResponse?: unknown;
    currentSessionTools?: unknown[];
    tools?: Array<{ name: string; description?: string; inputSchema?: unknown; ui?: unknown }>;
    diagnosticFile?: string;
    errors: string[];
  };
}

export interface ExcelMcpToolLifecycleTelemetry {
  started: number;
  completed: number;
  failed: number;
  denied: number;
  inFlight: number;
  totalDurationMs: number;
  lastToolName?: string;
  calls: ExcelMcpToolCallTelemetry[];
}

export interface ExcelMcpToolCallTelemetry {
  toolCallId: string;
  serverName: string;
  toolName: string;
  status: "inFlight" | "completed" | "failed" | "denied";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export type ExcelSessionWaitOutcome = "idle" | "idleTimeout" | "sessionError" | "aborted" | "toolError" | "sdkError";

export interface ExcelMcpBudgetTelemetry {
  limits: {
    maxCalls: number;
    maxRecoveries: number;
    maxConsecutiveFailures: number;
    maxDurationMs: number;
  };
  calls: number;
  recoveries: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  elapsedMs: number;
  deadlineAborted: boolean;
  exhaustedCode?: "maxToolCalls" | "maxRecoveries" | "maxConsecutiveFailures" | "maxDuration";
  exhaustedReason?: string;
}

export type ExcelLifecycleState = "planning" | "executing" | "validating" | "mcpRecovery" | "clarification" | "completed" | "failed";

export interface ExcelLifecycleTransition {
  state: ExcelLifecycleState;
  at: string;
  reason?: string;
}

export interface ExcelValidationTelemetry {
  started: boolean;
  completed: boolean;
  passed: boolean;
  evidence: string[];
  errors: string[];
}
