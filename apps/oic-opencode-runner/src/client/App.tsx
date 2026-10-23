import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, FastForward, FileSpreadsheet, Play, RefreshCw, ShieldCheck, Square, TerminalSquare, Upload } from "lucide-react";
import type { NormalizedTestCase, RunProfile, RunnerJob, RunnerSettings, WorkbookDescriptor, WorkbookSummary } from "../shared/types.js";

interface HealthResponse {
  ok: boolean;
  settings: RunnerSettings;
}

interface PermissionResponse {
  allowedCommands: string[];
  allowedWrites: string[];
  commandPolicyReady: boolean;
  writePolicyReady: boolean;
}

const DEFAULT_PORTAL_URL = "https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome";

export function App() {
  const [health, setHealth] = useState<HealthResponse>();
  const [workbooks, setWorkbooks] = useState<WorkbookDescriptor[]>([]);
  const [workbook, setWorkbook] = useState<WorkbookSummary>();
  const [jobs, setJobs] = useState<RunnerJob[]>([]);
  const [permissions, setPermissions] = useState<PermissionResponse>();
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedWorkbookId, setSelectedWorkbookId] = useState("default");
  const [runProfile, setRunProfile] = useState<RunProfile>({
    portalUrl: DEFAULT_PORTAL_URL,
    tenantName: "",
    username: "",
    storageStatePath: "",
    notes: ""
  });
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [signInStatus, setSignInStatus] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [command, setCommand] = useState("");
  const [commandStatus, setCommandStatus] = useState("");
  const [runExistingStatus, setRunExistingStatus] = useState("");

  async function load(workbookId = selectedWorkbookId) {
    setIsLoading(true);
    try {
      const [healthResponse, workbooksResponse, workbookResponse, jobsResponse, permissionsResponse] = await Promise.all([
        apiJson<HealthResponse>("/api/health"),
        apiJson<WorkbookDescriptor[]>("/api/workbooks"),
        apiJson<WorkbookSummary>(`/api/workbook?workbookId=${encodeURIComponent(workbookId)}`),
        apiJson<RunnerJob[]>("/api/jobs"),
        apiJson<PermissionResponse>("/api/permissions")
      ]);
      setHealth(healthResponse);
      setWorkbooks(Array.isArray(workbooksResponse) ? workbooksResponse : []);
      setWorkbook(workbookResponse);
      setJobs(asJobs(jobsResponse));
      setPermissions(permissionsResponse);
      setSelectedId((current) => current || workbookResponse.testCases[0]?.id);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    apiJson<{ models: string[]; current: string }>("/api/models")
      .then((response) => {
        setModels(response.models);
        setSelectedModel((previous) => previous || response.current);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) {
      return;
    }

    const interval = window.setInterval(async () => {
      const jobsResponse = await apiJson<RunnerJob[]>("/api/jobs").catch(() => undefined);
      if (jobsResponse) {
        setJobs(asJobs(jobsResponse));
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [jobs]);

  const filteredCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cases = workbook?.testCases ?? [];
    if (!needle) {
      return cases;
    }
    return cases.filter((testCase) => [testCase.id, testCase.title, testCase.feature, testCase.priority].join(" ").toLowerCase().includes(needle));
  }, [query, workbook]);

  const selectedCase = filteredCases.find((testCase) => testCase.id === selectedId) ?? filteredCases[0];

  async function queueSelectedCase(testCase: NormalizedTestCase) {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testCase, runProfile, password, model: selectedModel })
    });
    const job = (await response.json()) as RunnerJob;
    setPassword("");
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    return job;
  }

  async function runExistingSelectedCase(testCase: NormalizedTestCase) {
    setRunExistingStatus(`Looking for an existing compiled test for ${testCase.id}...`);
    const response = await fetch("/api/jobs/run-existing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testCase, runProfile, password, model: selectedModel })
    });
    const result = (await response.json()) as { found: boolean; message?: string; job?: RunnerJob };
    if (!result.found || !result.job) {
      setRunExistingStatus(result.message ?? `No existing test found for ${testCase.id}. Generate it first.`);
      return;
    }
    setRunExistingStatus(`Running the existing compiled test for ${testCase.id}...`);
    setJobs((current) => [result.job as RunnerJob, ...current.filter((item) => item.id !== result.job!.id)]);
  }

  async function cancelJob(job: RunnerJob) {
    const cancelled = await apiJson<RunnerJob>(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
    setJobs((current) => current.map((item) => item.id === cancelled.id ? cancelled : item));
  }

  async function runCommand() {
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }
    if (/@/.test(trimmed)) {
      setCommandStatus("That looks like a username. Enter it in the Username field (top-left). Here, type a command like \"run the first test case\".");
      return;
    }
    const cases = workbook?.testCases ?? [];
    const resolved = resolveCaseFromCommand(trimmed, cases);
    if (!resolved) {
      setCommandStatus(`Could not match "${trimmed}" to a test case. Try "run the first test case", "run test case 10", or a TC id.`);
      return;
    }
    setSelectedId(resolved.id);
    await queueSelectedCase(resolved);
    setCommandStatus(`Queued ${resolved.id} — ${resolved.title.slice(0, 60)}${resolved.title.length > 60 ? "..." : ""}`);
    setCommand("");
  }

  async function uploadWorkbook(file: File) {
    const contentBase64 = await fileToBase64(file);
    const uploaded = await fetch("/api/workbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentBase64 })
    }).then((response) => response.json()) as WorkbookDescriptor;

    setSelectedWorkbookId(uploaded.id);
    setSelectedId(undefined);
    await load(uploaded.id);
  }

  async function selectWorkbook(workbookId: string) {
    setSelectedWorkbookId(workbookId);
    setSelectedId(undefined);
    await load(workbookId);
  }

  async function signInToOracle() {
    if (!runProfile.username || !password) {
      setSignInStatus("Enter both username and password first.");
      return;
    }
    setIsSigningIn(true);
    setSignInStatus("Signing in... a Chrome window will open. Complete MFA there if prompted.");
    try {
      const result = await apiJson<{ ok: boolean; signedIn: boolean; message?: string; storageStatePath?: string }>("/api/browser/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: runProfile.username, password })
      });
      if (result.storageStatePath) {
        setRunProfile((current) => ({ ...current, storageStatePath: result.storageStatePath ?? current.storageStatePath }));
      }
      setSignInStatus(result.message ?? (result.signedIn ? "Signed in." : "Sign-in started — finish in the browser window."));
      setPassword("");
    } catch {
      setSignInStatus("Sign-in failed. Check the Chrome window (MFA?) and try again.");
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Local automation console</p>
          <h1>OIC OpenCode Runner</h1>
          <p className="heroText">Excel test cases become verified Oracle OIC Java/TestNG Playwright automation through the existing agent workflow, OpenCode server sessions, MCP evidence, and focused Maven validation.</p>
        </div>
        <button className="iconButton" onClick={() => void load()} aria-label="Refresh data" title="Refresh data">
          <RefreshCw size={20} />
        </button>
      </section>

      <section className="metricsGrid" aria-label="Runner status">
        <Metric icon={<FileSpreadsheet />} label="Workbook cases" value={String(workbook?.testCases.length ?? 0)} detail={workbook?.sheets.map((sheet) => sheet.name).join(", ") || "Loading workbook"} />
        <Metric icon={<Bot />} label="OpenCode model" value={selectedModel || health?.settings.model || "..."} detail="Change it in the Model dropdown" />
        <Metric icon={<ShieldCheck />} label="Autonomy guard" value={permissions?.commandPolicyReady && permissions.writePolicyReady ? "Ready" : "Review"} detail="Allowlisted commands and writes" />
        <Metric icon={<TerminalSquare />} label="Jobs" value={String(jobs.length)} detail={jobs[0]?.phase || "No jobs queued yet"} />
      </section>

      <section className="workspace">
        <div className="panel testCasesPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Excel source</p>
              <h2>Test cases</h2>
            </div>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter TC, feature, title" aria-label="Filter test cases" />
          </div>

          <div className="signInBar">
            <input value={runProfile.username} onChange={(event) => setRunProfile({ ...runProfile, username: event.target.value })} placeholder="Username (e.g. TKJF78)" aria-label="Username" />
            <input type="password" value={password} autoComplete="off" onChange={(event) => setPassword(event.target.value)} placeholder="Password (used once, not stored)" aria-label="Password" />
            <button className="secondaryButton" type="button" disabled={isSigningIn} onClick={() => void signInToOracle()}>
              <ShieldCheck size={16} />{isSigningIn ? "Signing in..." : "Sign in"}
            </button>
          </div>
          {signInStatus ? <p className="muted">{signInStatus}</p> : null}

          <div className="workbookControls">
            <label>
              Workbook
              <select value={selectedWorkbookId} onChange={(event) => void selectWorkbook(event.target.value)}>
                {workbooks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              Model
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {(models.length > 0 ? models : selectedModel ? [selectedModel] : []).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
            <label className="uploadButton">
              <Upload size={16} />
              Attach Excel
              <input type="file" accept=".xlsx" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadWorkbook(file);
                }
                event.target.value = "";
              }} />
            </label>
          </div>

          <div className="commandRow">
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void runCommand(); }}
              placeholder='Type a command: "run the first test case", "run test case 10", or a TC id'
              aria-label="Run command"
            />
            <button className="primaryButton" type="button" onClick={() => void runCommand()}>
              <Play size={16} /> Run
            </button>
          </div>
          {commandStatus ? <p className="muted">{commandStatus}</p> : null}

          {isLoading ? <p className="muted">Reading workbook...</p> : null}
          <div className="caseList">
            {filteredCases.map((testCase) => (
              <button key={`${testCase.sheetName}-${testCase.rowNumber}-${testCase.id}`} className={testCase.id === selectedCase?.id ? "caseItem active" : "caseItem"} onClick={() => setSelectedId(testCase.id)}>
                <span className="caseId">{testCase.id}</span>
                <span className="caseTitle">{testCase.title}</span>
                <span className="caseMeta">{testCase.feature} / row {testCase.rowNumber}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel detailPanel">
          {selectedCase ? (
            <>
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Selected row</p>
                  <h2>{selectedCase.id}</h2>
                </div>
                <button className="primaryButton" onClick={() => void queueSelectedCase(selectedCase)}>
                  <Play size={18} />
                  Run autonomously
                </button>
              </div>
              <h3>{selectedCase.title}</h3>
              <p className="muted">Enter your <strong>username</strong> and <strong>password</strong> at the top-left, then click <strong>Run autonomously</strong> — it signs in and runs. (Use <strong>Sign in</strong> up there first only if your tenant needs MFA.)</p>
              <div className="runExistingRow">
                <button className="secondaryButton" type="button" onClick={() => void runExistingSelectedCase(selectedCase)}>
                  <FastForward size={16} />
                  Run existing test
                </button>
                <span className="muted">Fast path: runs the already-generated compiled test via Maven (no regeneration). Falls back to a notice if none exists yet.</span>
              </div>
              {runExistingStatus ? <p className="statusLine">{runExistingStatus}</p> : null}
              <dl className="details">
                <div><dt>Feature</dt><dd>{selectedCase.feature}</dd></div>
                <div><dt>Priority</dt><dd>{selectedCase.priority}</dd></div>
                <div><dt>Source</dt><dd>{selectedCase.sourceWorkbook} / {selectedCase.sheetName} / row {selectedCase.rowNumber}</dd></div>
              </dl>
              <div className="twoColumn">
                <section>
                  <h4>Steps</h4>
                  <ol>
                    {selectedCase.steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
                  </ol>
                </section>
                <section>
                  <h4>Expected</h4>
                  <p>{selectedCase.expectedResult || "No expected result column detected yet."}</p>
                  <h4>Preconditions</h4>
                  <p>{selectedCase.preconditions || "No preconditions column detected yet."}</p>
                </section>
              </div>
            </>
          ) : (
            <p className="muted">No test case selected.</p>
          )}
        </div>
      </section>

      <section className="panel jobsPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Run history</p>
            <h2>Automation jobs</h2>
          </div>
          <CheckCircle2 className="okIcon" size={24} />
        </div>
        <div className="jobsGrid">
          {jobs.length === 0 ? <p className="muted">Prepare a selected test case to create the first job record.</p> : null}
          {jobs.map((job) => (
            <article key={job.id} className="jobCard">
              <span className={`status ${job.status}`}>{job.status}</span>
              <h3>{job.testCase.id}</h3>
              <p>{job.phase}</p>
              {job.status === "queued" || job.status === "running" ? (
                <button className="secondaryButton" type="button" onClick={() => void cancelJob(job)}>
                  <Square size={14} /> Stop run
                </button>
              ) : null}
              <ul>
                {job.log.slice(-3).map((line, index) => <li key={`${job.id}-${job.log.length - 3 + index}`}>{line}</li>)}
              </ul>
              {job.artifacts?.some((artifact) => artifact.kind === "report") ? (
                <a className="reportLink" href={`/api/reports/${job.id}`} target="_blank" rel="noreferrer">
                  <FileSpreadsheet size={14} /> Open Extent report
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function asJobs(value: unknown): RunnerJob[] {
  return Array.isArray(value) ? value as RunnerJob[] : [];
}

function resolveCaseFromCommand(command: string, testCases: NormalizedTestCase[]): NormalizedTestCase | undefined {
  const text = command.toLowerCase().trim();
  if (!text || testCases.length === 0) {
    return undefined;
  }

  const idMatch = text.match(/\b(?:tc#?\s*)?(\d{5,})\b/);
  if (idMatch) {
    const wanted = idMatch[1];
    const byId = testCases.find((testCase) => testCase.id === wanted || testCase.id.replace(/\D/g, "") === wanted);
    if (byId) {
      return byId;
    }
  }

  const ordinals: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    last: testCases.length
  };
  let position: number | undefined;
  for (const [word, value] of Object.entries(ordinals)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      position = value;
      break;
    }
  }
  if (position === undefined) {
    const numberMatch = text.match(/\b(\d{1,4})(?:st|nd|rd|th)?\b/);
    if (numberMatch) {
      position = Number(numberMatch[1]);
    }
  }
  if (position !== undefined && position >= 1 && position <= testCases.length) {
    return testCases[position - 1];
  }

  return undefined;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric">
      <div className="metricIcon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}
