import cors from "cors";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import multer from "multer";
import path from "node:path";
import express from "express";
import { DEFAULT_OIC_PORTAL_URL, loginOic, openOicBrowserPreflight, saveOicStorageState } from "./browserPreflight.js";
import { paths, settings } from "./config.js";
import { parseWorkbook } from "./excelParser.js";
import { createJob, ensureDataFolders, listJobs, markInterruptedJobs, saveJob } from "./jobStore.js";
import { cancelCopilotJob, createCopilotClient, evaluatePermissionPreview, explainExcelAnalysis, getPermissionPreview, runAutonomousJob, runExistingTestJob } from "./copilotRunner.js";
import { cancelExcelCopilotRun } from "./excelCopilotRuntime.js";
import { explainTransactionAnalysis } from "./copilotRunner.js";
import { discoverExcelFiles, runExcelAnalysis, runExcelPrompt, type EncodedExcelFile } from "./excelExpertAgent.js";
import { createExcelAnalysisReport } from "./excelReportGenerator.js";
import { findExistingTestCase } from "./testDiscovery.js";
import { analyzeTransactionBatch } from "./transactionAnalysis.js";
import { adaptTransactionFiles } from "./transactionFileAdapter.js";
import { getWorkbookById, listWorkbooks, saveUploadedWorkbook } from "./workbookStore.js";
import type { UploadedFile } from "./uploadedFile.js";
import { resolveExcelArtifact } from "./excelArtifactStore.js";

async function listAvailableModels(): Promise<{ models: string[]; current: string }> {
  const client = await createCopilotClient();
  try {
    await client.start();
    const available = await client.listModels();
    const models = available.map((model) => model.id).filter((id): id is string => Boolean(id) && id !== "auto");
    const preferred = [settings.model, "gpt-5.6-luna", "mai-code-1.1-flash"];
    const current = preferred.find((model) => models.includes(model)) ?? models[0];
    return { models, current };
  } finally {
    await client.stop();
  }
}

const app = express();
const port = Number(process.env.OIC_RUNNER_PORT) || 3000;
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_UPLOAD_FILES = 20;
const multipartUpload = multer({
  storage: multer.diskStorage({
    destination: (request, _file, callback) => {
      const uploadRequest = request as UploadRequest;
      if (!uploadRequest.uploadDirectory) {
        fs.mkdirSync(paths.runtimeDataPath, { recursive: true });
        uploadRequest.uploadDirectory = fs.mkdtempSync(path.join(paths.runtimeDataPath, "multipart-"));
      }
      callback(null, uploadRequest.uploadDirectory);
    },
    filename: (_request, file, callback) => {
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { files: MAX_UPLOAD_FILES, fileSize: MAX_UPLOAD_BYTES }
});

interface UploadRequest extends express.Request {
  uploadDirectory?: string;
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (kept server alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (kept server alive):", error);
});

app.use(cors());
app.use(express.json({ limit: "100mb" }));

function multipartFiles(request: express.Request): UploadedFile[] {
  const files = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
  return files.map((file) => ({ fileName: file.originalname, filePath: file.path, size: file.size }));
}

async function cleanupMultipartFiles(request: express.Request): Promise<void> {
  const uploadRequest = request as UploadRequest;
  if (uploadRequest.uploadDirectory) {
    await fsPromises.rm(uploadRequest.uploadDirectory, { recursive: true, force: true });
    uploadRequest.uploadDirectory = undefined;
  }
}

function multipartJsonField(request: express.Request, field: string): unknown {
  const value = request.body?.[field];
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, settings });
});

app.get("/api/workbook", async (_request, response, next) => {
  try {
    const workbook = await getWorkbookById(typeof _request.query.workbookId === "string" ? _request.query.workbookId : undefined);
    response.json(await parseWorkbook(workbook.path, workbook.id));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/workbooks", async (_request, response, next) => {
  try {
    response.json(await listWorkbooks());
  } catch (error) {
    next(error);
  }
});

app.post("/api/workbooks", async (request, response, next) => {
  try {
    response.status(201).json(await saveUploadedWorkbook(request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transaction-analysis", multipartUpload.array("files", MAX_UPLOAD_FILES), async (request, response, next) => {
  try {
    const files = await adaptTransactionFiles(multipartFiles(request));
    response.json(analyzeTransactionBatch(files));
  } catch (error) {
    next(error);
  } finally {
    await cleanupMultipartFiles(request);
  }
});

app.post("/api/transaction-analysis/copilot", multipartUpload.array("files", MAX_UPLOAD_FILES), async (request, response, next) => {
  try {
    const files = await adaptTransactionFiles(multipartFiles(request));
    const question = typeof request.body?.question === "string" ? request.body.question : "";
    response.json(await explainTransactionAnalysis(files, question));
  } catch (error) {
    next(error);
  } finally {
    await cleanupMultipartFiles(request);
  }
});

app.post("/api/excel-analysis/discover", multipartUpload.array("files", MAX_UPLOAD_FILES), async (request, response, next) => {
  try {
    response.json(await discoverExcelFiles(multipartFiles(request)));
  } catch (error) {
    next(error);
  } finally {
    await cleanupMultipartFiles(request);
  }
});

app.post("/api/excel-analysis", multipartUpload.array("files", MAX_UPLOAD_FILES), async (request, response, next) => {
  try {
    const plan = multipartJsonField(request, "plan");
    if (!plan || typeof plan !== "object" || !Array.isArray((plan as { operations?: unknown }).operations)) {
      response.status(400).json({ error: "An Excel analysis plan with operations is required." });
      return;
    }
    response.json(await runExcelAnalysis(multipartFiles(request), plan as Parameters<typeof runExcelAnalysis>[1]));
  } catch (error) {
    next(error);
  } finally {
    await cleanupMultipartFiles(request);
  }
});

app.post("/api/excel-analysis/prompt", multipartUpload.array("files", MAX_UPLOAD_FILES), async (request, response, next) => {
  try {
    const prompt = typeof request.body?.prompt === "string" ? request.body.prompt : "";
    if (!prompt.trim()) {
      response.status(400).json({ error: "An Excel analysis prompt is required." });
      return;
    }
    const runId = typeof request.body?.runId === "string" && request.body.runId.trim() ? request.body.runId.trim() : undefined;
    response.json(await runExcelPrompt(multipartFiles(request), prompt, undefined, undefined, {
      runId,
      autonomous: true,
      maxCompletionNudges: 1,
      captureMcpToolDiscovery: request.body?.captureMcpToolDiscovery === "true"
    }));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await cleanupMultipartFiles(request);
  }
});

app.post("/api/excel-analysis/cancel", async (request, response, next) => {
  try {
    const runId = typeof request.body?.runId === "string" ? request.body.runId.trim() : "";
    if (!runId) {
      response.status(400).json({ error: "An Excel Copilot runId is required." });
      return;
    }
    response.json({ runId, cancelled: await cancelExcelCopilotRun(runId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/excel-analysis/copilot", async (request, response, next) => {
  try {
    const analysis = request.body?.analysis;
    if (!analysis || !Array.isArray(analysis.operations)) {
      response.status(400).json({ error: "A completed Excel analysis is required." });
      return;
    }
    const question = typeof request.body?.question === "string" ? request.body.question : "";
    response.json(await explainExcelAnalysis(analysis, question));
  } catch (error) {
    next(error);
  }
});

app.post("/api/excel-analysis/report", (request, response) => {
  const analysis = request.body?.analysis;
  if (!analysis || !Array.isArray(analysis.operations)) {
    response.status(400).json({ error: "A completed Excel analysis is required." });
    return;
  }
  response.json(createExcelAnalysisReport(analysis, typeof request.body?.fileName === "string" ? request.body.fileName : undefined));
});

app.get("/api/excel-analysis/artifacts/:id", async (request, response) => {
  const artifact = await resolveExcelArtifact(request.params.id);
  if (!artifact) {
    response.status(404).json({ error: "Excel artifact not found or expired." });
    return;
  }
  response.download(artifact.filePath, artifact.fileName, { headers: { "Content-Type": artifact.mimeType } }, (error) => {
    if (error && !response.headersSent) response.status(404).json({ error: "Excel artifact not found or expired." });
  });
});

app.get("/api/jobs", async (_request, response, next) => {
  try {
    response.json(await listJobs());
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs", async (request, response, next) => {
  try {
    // Password is used once for sign-in and never persisted with the job.
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const model = typeof request.body?.model === "string" ? request.body.model : "";
    const job = await createJob(request.body.testCase, request.body.runProfile, model);
    response.status(202).json(job);

    void runAutonomousJob(job, saveJob, password).catch(async (error) => {
      await saveJob({
        ...job,
        status: "failed",
        phase: "Copilot SDK run failed before startup",
        updatedAt: new Date().toISOString(),
        log: [...job.log, error instanceof Error ? error.message : String(error)]
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs/run-existing", async (request, response, next) => {
  try {
    const testCase = request.body?.testCase;
    if (!testCase?.id) {
      response.status(400).json({ error: "A testCase with an id is required." });
      return;
    }

    // Check first so a missing test never creates a long-running job.
    const match = await findExistingTestCase(String(testCase.id));
    if (!match) {
      response.json({ found: false, message: `No existing test found for TC#${testCase.id}. Generate it first, then run existing.` });
      return;
    }

    const model = typeof request.body?.model === "string" ? request.body.model : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const job = await createJob(testCase, request.body.runProfile, model);
    response.status(202).json({ found: true, job });

    void runExistingTestJob(job, saveJob, password).catch(async (error) => {
      await saveJob({
        ...job,
        status: "failed",
        phase: "Existing-test run failed before startup",
        updatedAt: new Date().toISOString(),
        log: [...job.log, error instanceof Error ? error.message : String(error)]
      });
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs/:jobId/cancel", async (request, response, next) => {
  try {
    const jobId = String(request.params.jobId);
    const jobs = await listJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found." });
      return;
    }

    const stopped = await cancelCopilotJob(jobId);
    const cancelled = {
      ...job,
      status: "cancelled" as const,
      phase: "Cancelled by user",
      log: [...job.log, stopped ? "Copilot SDK run cancelled by user." : "Job marked cancelled; no active SDK session was found."]
    };
    await saveJob(cancelled);
    response.json(cancelled);
  } catch (error) {
    next(error);
  }
});

app.get("/api/permissions", (_request, response) => {
  response.json({ ...getPermissionPreview(), ...evaluatePermissionPreview() });
});

app.post("/api/browser/preflight", async (_request, response, next) => {
  try {
    response.json({ ok: true, message: await openOicBrowserPreflight(typeof _request.body?.portalUrl === "string" ? _request.body.portalUrl : DEFAULT_OIC_PORTAL_URL) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/browser/storage-state", async (_request, response, next) => {
  try {
    response.json({ ok: true, storageStatePath: await saveOicStorageState() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/browser/login", async (request, response, next) => {
  try {
    const username = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!username || !password) {
      response.status(400).json({ ok: false, message: "Username and password are required." });
      return;
    }
    response.json(await loginOic(username, password));
  } catch (error) {
    next(error);
  }
});

app.get("/api/models", async (_request, response) => {
  response.json(await listAvailableModels());
});

app.get("/api/reports/:jobId", (request, response) => {
  const jobId = String(request.params.jobId).replace(/[^a-zA-Z0-9._-]/g, "");
  const reportPath = path.join(paths.reportsPath, `${jobId}.html`);
  response.sendFile(reportPath, (error) => {
    if (error && !response.headersSent) {
      response.status(404).json({ error: "Report not found. It is generated when the run finishes." });
    }
  });
});

app.use(async (error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
  await cleanupMultipartFiles(request);
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" || error.code === "LIMIT_FILE_COUNT" ? 413 : 400;
    const message = error.code === "LIMIT_FILE_SIZE"
      ? `A selected file exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB per-file limit.`
      : error.code === "LIMIT_FILE_COUNT"
        ? `You can upload at most ${MAX_UPLOAD_FILES} files at a time.`
        : error.message;
    response.status(status).json({ error: message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
});

await ensureDataFolders();
await markInterruptedJobs();

app.listen(port, "127.0.0.1", () => {
  console.log(`OIC Copilot Runner API listening on http://127.0.0.1:${port}`);
});
