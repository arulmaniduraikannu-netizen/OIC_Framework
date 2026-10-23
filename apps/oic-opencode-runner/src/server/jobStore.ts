import fs from "node:fs/promises";
import path from "node:path";
import type { NormalizedTestCase, RunProfile, RunnerJob } from "../shared/types.js";
import { paths } from "./config.js";

export async function ensureDataFolders(): Promise<void> {
  await fs.mkdir(paths.jobsPath, { recursive: true });
}

export async function listJobs(): Promise<RunnerJob[]> {
  await ensureDataFolders();
  const files = await fs.readdir(paths.jobsPath);
  const jobs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJobFile(file))
  );
  return jobs
    .filter((job): job is RunnerJob => Boolean(job))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createJob(testCase: NormalizedTestCase, runProfile: RunProfile, model?: string): Promise<RunnerJob> {
  await ensureDataFolders();
  const now = new Date().toISOString();
  const job: RunnerJob = {
    id: `${Date.now()}-${sanitize(testCase.id)}`,
    status: "queued",
    testCase,
    runProfile,
    model: model?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    phase: "Queued for autonomous routing",
    log: ["Job created from Excel row.", "Next: run the OIC generate-and-drive workflow — live-drive the Oracle Fusion portal with the Playwright MCP browser and generate a verified test."],
    artifacts: []
  };
  await saveJob(job);
  return job;
}

export async function markInterruptedJobs(): Promise<void> {
  const jobs = await listJobs();
  await Promise.all(
    jobs
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => saveJob({
        ...job,
        status: "blocked",
        phase: "Interrupted by runner restart",
        log: [...job.log, "This job was marked blocked because the local runner restarted before it completed. Start a new run to use the latest MCP/browser configuration."]
      }))
  );
}

export async function saveJob(job: RunnerJob): Promise<void> {
  await ensureDataFolders();
  job.updatedAt = new Date().toISOString();
  const finalPath = path.join(paths.jobsPath, `${job.id}.json`);
  const contents = JSON.stringify(job, null, 2);
  const temporaryPath = `${finalPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  try {
    await fs.writeFile(temporaryPath, contents);
    await renameWithRetry(temporaryPath, finalPath);
  } catch {
    await fs.writeFile(finalPath, contents);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retriable = code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "EEXIST";
      if (!retriable || attempt === attempts) {
        throw error;
      }
      await delay(50 * attempt);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJobFile(file: string): Promise<RunnerJob | undefined> {
  const filePath = path.join(paths.jobsPath, file);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as RunnerJob;
  } catch {
    const badPath = path.join(paths.jobsPath, `${file}.bad-${Date.now()}`);
    await fs.rename(filePath, badPath).catch(() => undefined);
    return undefined;
  }
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "case";
}
