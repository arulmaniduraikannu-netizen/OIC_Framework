import cors from "cors";
import path from "node:path";
import express from "express";
import { DEFAULT_OIC_PORTAL_URL, loginOic, openOicBrowserPreflight, saveOicStorageState } from "./browserPreflight.js";
import { paths, settings } from "./config.js";
import { parseWorkbook } from "./excelParser.js";
import { createJob, ensureDataFolders, listJobs, markInterruptedJobs, saveJob } from "./jobStore.js";
import { cancelOpenCodeJob, evaluatePermissionPreview, getPermissionPreview, runAutonomousJob, runExistingTestJob } from "./opencodeRunner.js";
import { findExistingTestCase } from "./testDiscovery.js";
import { getWorkbookById, listWorkbooks, saveUploadedWorkbook } from "./workbookStore.js";

const FALLBACK_MODELS = [
  "opencode/big-pickle",
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/hy3-free",
  "opencode/nemotron3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/laguna-s2.1-free"
];

async function listAvailableModels(): Promise<{ models: string[]; current: string }> {
  return { models: FALLBACK_MODELS, current: settings.model };
}

const app = express();
const port = Number(process.env.OIC_RUNNER_PORT) || 3001;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (kept server alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (kept server alive):", error);
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, settings });
});

app.get("/api/workbook", async (request, response, next) => {
  try {
    const workbook = await getWorkbookById(typeof request.query.workbookId === "string" ? request.query.workbookId : undefined);
    response.json(await parseWorkbook(workbook.path, workbook.id));
  } catch (error) {
    next(error);
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

app.get("/api/jobs", async (_request, response, next) => {
  try {
    response.json(await listJobs());
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs", async (request, response, next) => {
  try {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const model = typeof request.body?.model === "string" ? request.body.model : "";
    const job = await createJob(request.body.testCase, request.body.runProfile, model);
    response.status(202).json(job);

    void runAutonomousJob(job, saveJob, password).catch(async (error) => {
      await saveJob({
        ...job,
        status: "failed",
        phase: "OpenCode run failed before startup",
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

    const stopped = await cancelOpenCodeJob(jobId);
    const cancelled = {
      ...job,
      status: "cancelled" as const,
      phase: "Cancelled by user",
      log: [...job.log, stopped ? "OpenCode run cancelled by user." : "Job marked cancelled; no active OpenCode session was found."]
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

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  response.status(500).json({ error: message });
});

await ensureDataFolders();
await markInterruptedJobs();

app.listen(port, "127.0.0.1", () => {
  console.log(`OIC OpenCode Runner API listening on http://127.0.0.1:${port}`);
});
