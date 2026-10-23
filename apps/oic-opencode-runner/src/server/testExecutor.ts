import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { RunProfile } from "../shared/types.js";
import { paths, settings } from "./config.js";
import type { ExistingTestCaseMatch } from "./testDiscovery.js";

export interface TestRunResult {
  command: string;
  exitCode: number | null;
  output: string;
}

export async function runExistingTest(match: ExistingTestCaseMatch, runProfile: RunProfile): Promise<TestRunResult> {
  const args = [
    "test",
    "-Dtest=" + match.fullyQualifiedName,
    "-DsuiteXmlFiles="
  ];
  const resolvedProfile: RunProfile = { ...runProfile, storageStatePath: resolveStorageState(runProfile) };
  return runProcess("mvn", args, 20 * 60 * 1000, resolvedProfile);
}

function resolveStorageState(runProfile: RunProfile): string {
  if (runProfile.storageStatePath && fs.existsSync(runProfile.storageStatePath)) {
    return runProfile.storageStatePath;
  }
  const fromEnv = process.env.OIC_STORAGE_STATE;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  try {
    const newest = fs.readdirSync(paths.authPath)
      .filter((file) => file.startsWith("oic-state-") && file.endsWith(".json"))
      .map((file) => ({ file, mtime: fs.statSync(path.join(paths.authPath, file)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)[0];
    if (newest) {
      return path.join(paths.authPath, newest.file);
    }
  } catch {
    // no saved auth state yet
  }
  return "";
}

function runProcess(command: string, args: string[], timeoutMs: number, runProfile: RunProfile): Promise<TestRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: settings.repoRoot,
      shell: false,
      env: {
        ...process.env,
        OIC_PORTAL_URL: runProfile.portalUrl || "https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome",
        OIC_TENANT_NAME: runProfile.tenantName,
        OIC_ADMIN_USER: runProfile.username,
        OIC_STORAGE_STATE: runProfile.storageStatePath || process.env.OIC_STORAGE_STATE || "",
        HEADED: process.env.HEADED ?? "1"
      }
    });
    const chunks: string[] = [];
    const timer = setTimeout(() => {
      chunks.push(`\nProcess timed out after ${timeoutMs / 1000} seconds. Killing ${command}.\n`);
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(String(chunk)));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        exitCode,
        output: chunks.join("").slice(-12_000)
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        exitCode: -1,
        output: error.message
      });
    });
  });
}
