import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnerSettings } from "../shared/types.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const appRoot = path.resolve(currentDir, "..", "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const localAppData = process.env.LOCALAPPDATA ?? path.join(repoRoot, ".oic-runner");

export const settings: RunnerSettings = {
  repoRoot,
  workbookPath: process.env.OIC_RUNNER_WORKBOOK_PATH ?? path.join(repoRoot, "src", "test", "resources", "testdata", "Verifying _UCM_Server_files.xlsx"),
  appDataPath: path.join(appRoot, "data"),
  runtimeDataPath: process.env.OIC_RUNNER_RUNTIME_PATH ?? path.join(localAppData, "OicCopilotRunner"),
  mcpConfigPath: path.join(repoRoot, ".vscode", "mcp.json"),
  model: process.env.COPILOT_MODEL || "gpt-5.6-luna"
};

export const paths = {
  appRoot,
  repoRoot,
  runtimeDataPath: settings.runtimeDataPath,
  authPath: path.join(settings.runtimeDataPath, "auth"),
  browserProfilePath: path.join(settings.runtimeDataPath, "browser-profile"),
  copilotHomePath: path.join(settings.runtimeDataPath, "copilot-home"),
  jobsPath: path.join(settings.appDataPath, "jobs"),
  workbooksPath: path.join(settings.appDataPath, "workbooks"),
  reportsPath: path.join(settings.appDataPath, "reports"),
  excelArtifactsPath: path.join(settings.appDataPath, "excel-artifacts")
};
