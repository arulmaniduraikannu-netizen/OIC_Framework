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
