import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, FastForward, FileSpreadsheet, Play, RefreshCw, ShieldCheck, Square, TerminalSquare, Upload } from "lucide-react";
import type { ExcelAnalysisResult, ExcelArtifact, ExcelOperationKind, ExcelPromptResponse, ExcelTable, ExcelWorkbookSnapshot, NormalizedTestCase, RunProfile, RunnerJob, RunnerSettings, WorkbookDescriptor, WorkbookSummary } from "../shared/types.js";

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

interface TransactionCurrencyTotal {
  currency: string;
  amountSum: string;
}

interface TransactionFileResult {
  fileName: string;
  rowCount: number;
  transactionNumberCount: number;
  amountSum: string;
  currencyTotals: TransactionCurrencyTotal[];
  diagnostics: { rowNumber: number; message: string; rawAmount: string }[];
  warnings: string[];
}

interface TransactionAnalysisResult {
  fileCount: number;
  rowCount: number;
  transactionNumberCount: number;
  amountSum: string;
  files: TransactionFileResult[];
  diagnostics: { fileName: string; rowNumber: number; message: string; rawAmount: string }[];
  warnings: string[];
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
  const [analysisFiles, setAnalysisFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<TransactionAnalysisResult>();
  const [analysisQuestion, setAnalysisQuestion] = useState("");
  const [analysisExplanation, setAnalysisExplanation] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAskingCopilot, setIsAskingCopilot] = useState(false);
  const [expertFiles, setExpertFiles] = useState<File[]>([]);
  const [expertSnapshot, setExpertSnapshot] = useState<ExcelWorkbookSnapshot>();
  const [expertAnalysis, setExpertAnalysis] = useState<ExcelAnalysisResult>();
  const [expertOperation, setExpertOperation] = useState<ExcelOperationKind>("filter");
  const [expertTable, setExpertTable] = useState("");
  const [expertOldTable, setExpertOldTable] = useState("");
  const [expertRightTable, setExpertRightTable] = useState("");
  const [expertColumn, setExpertColumn] = useState("");
  const [expertValue, setExpertValue] = useState("");
  const [expertGroupBy, setExpertGroupBy] = useState("");
  const [expertSumColumn, setExpertSumColumn] = useState("");
  const [expertKey, setExpertKey] = useState("");
  const [expertColumns, setExpertColumns] = useState("");
  const [expertRequiredColumns, setExpertRequiredColumns] = useState("");
  const [expertUniqueColumn, setExpertUniqueColumn] = useState("");
  const [expertQuestion, setExpertQuestion] = useState("");
  const [expertPrompt, setExpertPrompt] = useState("");
  const [expertClarificationQuestions, setExpertClarificationQuestions] = useState<string[]>([]);
  const [expertClarificationAnswer, setExpertClarificationAnswer] = useState("");
  const [expertMcpResult, setExpertMcpResult] = useState<Extract<ExcelPromptResponse, { status: "mcpCompleted" }>>();
  const [expertArtifacts, setExpertArtifacts] = useState<ExcelArtifact[]>([]);
  const [expertExplanation, setExpertExplanation] = useState("");
  const [expertReportStatus, setExpertReportStatus] = useState("");
  const [expertStatus, setExpertStatus] = useState("");
  const [isDiscoveringExpert, setIsDiscoveringExpert] = useState(false);
  const [isRunningExpert, setIsRunningExpert] = useState(false);
  const [isAskingExpert, setIsAskingExpert] = useState(false);

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
    setRunExistingStatus(`Looking for an existing compiled test for ${testCase.id}…`);
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
    setRunExistingStatus(`Running the existing compiled test for ${testCase.id}…`);
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
    setCommandStatus(`Queued ${resolved.id} — ${resolved.title.slice(0, 60)}${resolved.title.length > 60 ? "…" : ""}`);
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

  async function analyzeSelectedFiles() {
    if (analysisFiles.length === 0) {
      setAnalysisStatus("Select at least one CSV, XLSX, or ZIP file first.");
      return;
    }
    setIsAnalyzing(true);
    setAnalysisStatus("Analyzing files...");
    setAnalysisExplanation("");
    try {
      const result = await apiJson<TransactionAnalysisResult>("/api/transaction-analysis", {
        method: "POST",
        body: createFileFormData(analysisFiles)
      });
      setAnalysis(result);
      setAnalysisStatus(`Analysis complete for ${result.fileCount} file${result.fileCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setAnalysisStatus(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function askCopilotAboutAnalysis() {
    if (analysisFiles.length === 0 || !analysisQuestion.trim()) {
      setAnalysisStatus("Analyze files and enter a question before asking Copilot.");
      return;
    }
    setIsAskingCopilot(true);
    setAnalysisStatus("Asking Copilot...");
    try {
      const explanation = await apiJson<{ response: string }>("/api/transaction-analysis/copilot", {
        method: "POST",
        body: createFileFormData(analysisFiles, { question: analysisQuestion })
      });
      setAnalysisExplanation(explanation.response);
      setAnalysisStatus("Copilot explanation ready.");
    } catch (error) {
      setAnalysisStatus(error instanceof Error ? error.message : "Copilot request failed.");
    } finally {
      setIsAskingCopilot(false);
    }
  }

  async function discoverExpertFiles() {
    if (expertFiles.length === 0) {
      setExpertStatus("Choose at least one CSV, XLSX, or ZIP file first.");
      return;
    }
    setIsDiscoveringExpert(true);
    setExpertStatus("Discovering workbook sheets...");
    try {
      const snapshot = await apiJson<ExcelWorkbookSnapshot>("/api/excel-analysis/discover", {
        method: "POST",
        body: createFileFormData(expertFiles)
      });
      setExpertSnapshot(snapshot);
      setExpertTable((current) => current || snapshot.tables[0]?.name || "");
      setExpertOldTable((current) => current || snapshot.tables[0]?.name || "");
      setExpertRightTable((current) => current || snapshot.tables[1]?.name || "");
      setExpertAnalysis(undefined);
      setExpertMcpResult(undefined);
      setExpertExplanation("");
      setExpertStatus(`Discovered ${snapshot.tables.length} table${snapshot.tables.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setExpertStatus(error instanceof Error ? error.message : "Workbook discovery failed.");
    } finally {
      setIsDiscoveringExpert(false);
    }
  }

  async function runExpertOperation() {
    if (!expertSnapshot || !expertTable) {
      setExpertStatus("Discover the uploaded files before running an operation.");
      return;
    }
    setIsRunningExpert(true);
    setExpertStatus("Running deterministic Excel operation...");
    try {
      const options: Record<string, unknown> = {};
      if (expertOperation === "filter") {
        options.column = expertColumn;
        options.value = expertValue;
      } else if (expertOperation === "group") {
        options.groupBy = expertGroupBy;
        if (expertSumColumn.trim()) options.sumColumn = expertSumColumn.trim();
      } else if (expertOperation === "compare") {
        options.rightTable = expertRightTable;
        options.key = expertKey;
        options.columns = splitCommaList(expertColumns);
      } else if (expertOperation === "compareVersions") {
        options.oldTable = expertOldTable;
        options.newTable = expertRightTable;
        options.key = expertKey;
        options.columns = splitCommaList(expertColumns);
      } else if (expertOperation === "validate") {
        options.requiredColumns = splitCommaList(expertRequiredColumns);
        if (expertUniqueColumn.trim()) options.uniqueColumn = expertUniqueColumn.trim();
      }
      const result = await apiJson<ExcelAnalysisResult>("/api/excel-analysis", {
        method: "POST",
        body: createFileFormData(expertFiles, { plan: JSON.stringify({ operations: [{ id: "requested-operation", kind: expertOperation, inputTable: expertTable, options }] }) })
      });
      setExpertAnalysis(result);
      setExpertMcpResult(undefined);
      setExpertExplanation("");
      setExpertStatus("Excel operation complete.");
    } catch (error) {
      setExpertStatus(error instanceof Error ? error.message : "Excel operation failed.");
    } finally {
      setIsRunningExpert(false);
    }
  }

  async function runExpertPrompt(promptText = expertPrompt.trim()) {
    if (expertFiles.length === 0 || !promptText) {
      setExpertStatus("Choose a workbook and enter an Excel analysis or validation prompt first.");
      return;
    }
    setIsRunningExpert(true);
    setExpertAnalysis(undefined);
    setExpertMcpResult(undefined);
    setExpertArtifacts([]);
    setExpertExplanation("");
    setExpertStatus(expertSnapshot ? "Planning and running Excel analysis..." : "Discovering workbook and planning Excel analysis...");
    try {
      const result = await apiJson<ExcelPromptResponse>("/api/excel-analysis/prompt", {
        method: "POST",
        body: createFileFormData(expertFiles, { prompt: promptText, captureMcpToolDiscovery: "true" })
      });
      if (result.status === "completed") {
        setExpertAnalysis(result.analysis);
        setExpertArtifacts(result.artifacts ?? []);
        setExpertExplanation(result.explanation ?? "");
        setExpertClarificationQuestions([]);
        setExpertClarificationAnswer("");
        setExpertStatus("Prompt analysis complete.");
      } else if (result.status === "needsClarification") {
        setExpertClarificationQuestions(result.questions);
        setExpertStatus("Copilot needs clarification before running this analysis.");
      } else if (result.status === "mcpCompleted") {
        setExpertAnalysis(result.localAnalysis);
        setExpertMcpResult(result);
        setExpertArtifacts([]);
        setExpertExplanation("");
        setExpertClarificationQuestions([]);
        setExpertClarificationAnswer("");
        setExpertStatus(result.localAnalysis
          ? "Excel MCP completed the unsupported portion; deterministic local results are shown separately."
          : "Excel MCP completed this request. This answer was not verified by the local operation registry.");
      } else {
        setExpertClarificationQuestions([]);
        setExpertClarificationAnswer("");
        setExpertStatus(`Unsupported request: ${result.reason}`);
      }
    } catch (error) {
      setExpertStatus(error instanceof Error ? error.message : "Prompt analysis failed.");
    } finally {
      setIsRunningExpert(false);
    }
  }

  function submitExpertClarification() {
    const answer = expertClarificationAnswer.trim();
    if (!answer) {
      setExpertStatus("Enter an answer to the clarification question first.");
      return;
    }
    const clarifiedPrompt = `${expertPrompt.trim()}\n\nUser clarification: ${answer}`;
    setExpertPrompt(clarifiedPrompt);
    void runExpertPrompt(clarifiedPrompt);
  }

  async function askCopilotAboutExpertResult() {
    if (!expertAnalysis || !expertQuestion.trim()) {
      setExpertStatus("Run an Excel operation and enter a question before asking Copilot.");
      return;
    }
    setIsAskingExpert(true);
    setExpertStatus("Asking Copilot...");
    try {
      const result = await apiJson<{ response: string }>("/api/excel-analysis/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: expertAnalysis, question: expertQuestion })
      });
      setExpertExplanation(result.response);
      setExpertStatus("Copilot explanation ready.");
    } catch (error) {
      setExpertStatus(error instanceof Error ? error.message : "Copilot request failed.");
    } finally {
      setIsAskingExpert(false);
    }
  }

  async function downloadExpertReport(format: "markdown" | "csv") {
    if (!expertAnalysis) {
      return;
    }
    setExpertReportStatus("Preparing report...");
    try {
      const report = await apiJson<{ fileName: string; markdown: string; csv: string }>("/api/excel-analysis/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: expertAnalysis, fileName: expertTable })
      });
      const content = format === "csv" ? report.csv : report.markdown;
      const fileName = format === "csv" ? report.fileName.replace(/\.md$/i, ".csv") : report.fileName;
      const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      setExpertReportStatus(`${format === "csv" ? "CSV" : "Markdown"} report downloaded.`);
    } catch (error) {
      setExpertReportStatus(error instanceof Error ? error.message : "Report generation failed.");
    }
  }

  async function selectWorkbook(workbookId: string) {
    setSelectedWorkbookId(workbookId);
    setSelectedId(undefined);
    await load(workbookId);
  }

  async function saveLoginState() {
    const result = await apiJson<{ storageStatePath?: string }>("/api/browser/storage-state", { method: "POST" });
    if (result.storageStatePath) {
      setRunProfile((current) => ({ ...current, storageStatePath: result.storageStatePath ?? current.storageStatePath }));
    }
  }

  async function openLoginBrowser() {
    await apiJson<{ message: string }>("/api/browser/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portalUrl: runProfile.portalUrl })
    });
  }

  async function signInToOracle() {
    if (!runProfile.username || !password) {
      setSignInStatus("Enter both username and password first.");
      return;
    }
    setIsSigningIn(true);
    setSignInStatus("Signing in… a Chrome window will open. Complete MFA there if prompted.");
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
          <h1>OIC Copilot Runner</h1>
          <p className="heroText">Excel test cases become verified Oracle OIC Java/TestNG Playwright automation through the existing agent workflow, Copilot SDK sessions, MCP evidence, and focused Maven validation.</p>
        </div>
        <button className="iconButton" onClick={() => void load()} aria-label="Refresh data" title="Refresh data">
          <RefreshCw size={20} />
        </button>
      </section>

      <section className="metricsGrid" aria-label="Runner status">
        <Metric icon={<FileSpreadsheet />} label="Workbook cases" value={String(workbook?.testCases.length ?? 0)} detail={workbook?.sheets.map((sheet) => sheet.name).join(", ") || "Loading workbook"} />
        <Metric icon={<Bot />} label="Copilot model" value={selectedModel || health?.settings.model || "..."} detail="Change it in the Model dropdown" />
        <Metric icon={<ShieldCheck />} label="Autonomy guard" value={permissions?.commandPolicyReady && permissions.writePolicyReady ? "Ready" : "Review"} detail="Allowlisted commands and writes" />
        <Metric icon={<TerminalSquare />} label="Jobs" value={String(jobs.length)} detail={jobs[0]?.phase || "No jobs queued yet"} />
        <Metric icon={<TerminalSquare />} label="Token usage" value={formatTokens(jobs)} detail={formatTokenBreakdown(jobs)} />
        <Metric icon={<TerminalSquare />} label="AI credits used" value={formatAiCredits(jobs)} detail="Authoritative Copilot SDK session usage" />
        <Metric icon={<TerminalSquare />} label="Premium request cost" value={formatPremiumRequestCost(jobs)} detail="Reported by Copilot SDK" />
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
              <ShieldCheck size={16} />{isSigningIn ? "Signing in…" : "Sign in"}
            </button>
            <button className="secondaryButton" type="button" onClick={() => void openLoginBrowser()}>
              Open browser
            </button>
            <button className="secondaryButton" type="button" onClick={() => void saveLoginState()}>
              Save login state
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
              <p className="muted">Enter your <strong>username</strong> and <strong>password</strong> above, then click <strong>Run autonomously</strong>. It signs in, saves the session, and runs this case. For MFA, finish the prompt in the browser, save the login state, then run again.</p>
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

      <section className="panel analysisPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Transaction data</p>
            <h2>Analyze files</h2>
          </div>
          <button className="primaryButton" type="button" disabled={isAnalyzing || analysisFiles.length === 0} onClick={() => void analyzeSelectedFiles()}>
            <Play size={16} /> {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>
        </div>
        <div className="analysisControls">
          <label className="uploadButton">
            <Upload size={16} />
            Choose data files
            <input type="file" multiple accept=".csv,.xlsx,.zip" onChange={(event) => {
              setAnalysisFiles(Array.from(event.target.files ?? []));
              setAnalysisStatus("");
              setAnalysis(undefined);
              setAnalysisExplanation("");
              event.target.value = "";
            }} />
          </label>
          <span className="muted">{analysisFiles.length > 0 ? analysisFiles.map((file) => file.name).join(", ") : "CSV, XLSX, or ZIP; up to 20 files"}</span>
        </div>
        <label className="analysisQuestion">
          Ask Copilot about the results (optional)
          <textarea value={analysisQuestion} onChange={(event) => setAnalysisQuestion(event.target.value)} placeholder="For example: summarize the totals and any data-quality warnings" />
        </label>
        <button className="secondaryButton" type="button" disabled={isAskingCopilot || !analysis || !analysisQuestion.trim()} onClick={() => void askCopilotAboutAnalysis()}>
          <Bot size={16} /> {isAskingCopilot ? "Asking Copilot..." : "Ask Copilot"}
        </button>
        {analysisStatus ? <p className="statusLine">{analysisStatus}</p> : null}
        {analysis ? (
          <>
            <div className="analysisMetrics">
              <div><span>Files</span><strong>{analysis.fileCount}</strong></div>
              <div><span>Rows</span><strong>{analysis.rowCount}</strong></div>
              <div><span>Transactions</span><strong>{analysis.transactionNumberCount}</strong></div>
              <div><span>Raw amount total</span><strong>{analysis.amountSum}</strong></div>
            </div>
            {analysis.files.map((file) => (
              <article className="analysisFile" key={file.fileName}>
                <strong>{file.fileName}</strong>
                <span>{file.rowCount} rows, {file.transactionNumberCount} transaction numbers, total {file.amountSum}</span>
                <span>{file.currencyTotals.map((total) => `${total.currency}: ${total.amountSum}`).join(" | ") || "No valid currency totals"}</span>
              </article>
            ))}
            {analysis.warnings.map((warning) => <p className="warningLine" key={warning}>{warning}</p>)}
            {analysis.diagnostics.length > 0 ? <p className="muted">{analysis.diagnostics.length} amount diagnostic{analysis.diagnostics.length === 1 ? "" : "s"} found.</p> : null}
            {analysisExplanation ? <div className="copilotExplanation"><h3>Copilot explanation</h3><p>{analysisExplanation}</p></div> : null}
          </>
        ) : null}
      </section>

      <section className="panel analysisPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Excel Expert</p>
            <h2>Analyze any workbook</h2>
          </div>
          <div className="runExistingRow">
            <button className="secondaryButton" type="button" disabled={isDiscoveringExpert || expertFiles.length === 0} onClick={() => void discoverExpertFiles()}>
              <FileSpreadsheet size={16} /> {isDiscoveringExpert ? "Discovering..." : "Discover"}
            </button>
            <button className="primaryButton" type="button" disabled={isRunningExpert || !expertSnapshot} onClick={() => void runExpertOperation()}>
              <Play size={16} /> {isRunningExpert ? "Running..." : "Run operation"}
            </button>
          </div>
        </div>
        <div className="analysisControls">
          <label className="uploadButton">
            <Upload size={16} /> Choose workbook files
            <input type="file" multiple accept=".csv,.xlsx,.zip" onChange={(event) => {
              setExpertFiles(Array.from(event.target.files ?? []));
              setExpertSnapshot(undefined);
              setExpertAnalysis(undefined);
              setExpertMcpResult(undefined);
              setExpertArtifacts([]);
              setExpertClarificationQuestions([]);
              setExpertClarificationAnswer("");
              setExpertStatus("");
              event.target.value = "";
            }} />
          </label>
          <span className="muted">{expertFiles.length > 0 ? expertFiles.map((file) => file.name).join(", ") : "CSV, XLSX, or ZIP"}</span>
        </div>
        <div className="analysisQuestion">
          <label>Excel prompt<textarea value={expertPrompt} onChange={(event) => setExpertPrompt(event.target.value)} placeholder="Compare row 2 and row 3 across all columns" /></label>
          <button className="primaryButton" type="button" disabled={isRunningExpert || expertFiles.length === 0 || !expertPrompt.trim()} onClick={() => void runExpertPrompt()}>
            <Play size={16} /> {isRunningExpert ? "Running prompt..." : "Run prompt"}
          </button>
        </div>
        <div className="workbookControls">
          <label>Operation<select value={expertOperation} onChange={(event) => setExpertOperation(event.target.value as ExcelOperationKind)}>
            <option value="filter">Filter rows</option>
            <option value="group">Group and aggregate</option>
            <option value="compare">Compare tables</option>
            <option value="compareVersions">Compare old vs new</option>
            <option value="validate">Validate schema and duplicates</option>
          </select></label>
          <label>Input table<select value={expertTable} onChange={(event) => setExpertTable(event.target.value)}>
            {(expertSnapshot?.tables ?? []).map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
          </select></label>
        </div>
        {expertOperation === "filter" ? <div className="workbookControls">
          <label>Column<input value={expertColumn} onChange={(event) => setExpertColumn(event.target.value)} placeholder="Region" /></label>
          <label>Value<input value={expertValue} onChange={(event) => setExpertValue(event.target.value)} placeholder="East" /></label>
        </div> : null}
        {expertOperation === "group" ? <div className="workbookControls">
          <label>Group by<input value={expertGroupBy} onChange={(event) => setExpertGroupBy(event.target.value)} placeholder="Region" /></label>
          <label>Sum column (optional)<input value={expertSumColumn} onChange={(event) => setExpertSumColumn(event.target.value)} placeholder="Amount" /></label>
        </div> : null}
        {expertOperation === "compare" ? <div className="workbookControls">
          <label>Right table<select value={expertRightTable} onChange={(event) => setExpertRightTable(event.target.value)}>
            {(expertSnapshot?.tables ?? []).filter((table) => table.name !== expertTable).map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
          </select></label>
          <label>Key column<input value={expertKey} onChange={(event) => setExpertKey(event.target.value)} placeholder="Id" /></label>
          <label>Columns to compare<input value={expertColumns} onChange={(event) => setExpertColumns(event.target.value)} placeholder="Status, Amount" /></label>
        </div> : null}
        {expertOperation === "compareVersions" ? <div className="workbookControls">
          <label>Old table<select value={expertOldTable} onChange={(event) => setExpertOldTable(event.target.value)}>
            {(expertSnapshot?.tables ?? []).map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
          </select></label>
          <label>New table<select value={expertRightTable} onChange={(event) => setExpertRightTable(event.target.value)}>
            {(expertSnapshot?.tables ?? []).filter((table) => table.name !== expertOldTable).map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
          </select></label>
          <label>Business key<input value={expertKey} onChange={(event) => setExpertKey(event.target.value)} placeholder="Event ID" /></label>
          <label>Columns to compare<input value={expertColumns} onChange={(event) => setExpertColumns(event.target.value)} placeholder="Event Date, Amount" /></label>
        </div> : null}
        {expertOperation === "validate" ? <div className="workbookControls">
          <label>Required columns<input value={expertRequiredColumns} onChange={(event) => setExpertRequiredColumns(event.target.value)} placeholder="Id, Status" /></label>
          <label>Unique column (optional)<input value={expertUniqueColumn} onChange={(event) => setExpertUniqueColumn(event.target.value)} placeholder="Id" /></label>
        </div> : null}
        {expertStatus ? <p className="statusLine">{expertStatus}</p> : null}
        {expertMcpResult ? <article className="analysisFile">
          <strong>Copilot + Excel MCP result</strong>
          <span>Source: {expertMcpResult.source}</span>
          <span>Local verification: not performed</span>
          <span>Files: {expertMcpResult.files.join(", ")}</span>
          <span>Tools: {expertMcpResult.toolsUsed.join(", ") || "Tool usage not reported"}</span>
          <p>{expertMcpResult.answer}</p>
          {expertMcpResult.artifacts.map((artifact) => <a className="secondaryButton" href={artifact.downloadUrl} download={artifact.fileName} key={artifact.id}><FileSpreadsheet size={16} /> Download {artifact.fileName}</a>)}
        </article> : null}
        {expertSnapshot ? <p className="muted">{expertSnapshot.tables.map((table) => `${table.name}: ${table.rows.length} rows`).join(" | ")}</p> : null}
        {expertAnalysis ? <>
          {expertMcpResult?.localAnalysis ? <h3>Deterministic local results</h3> : null}
          <div className="analysisMetrics"><div><span>Operations</span><strong>{expertAnalysis.operations.length}</strong></div><div><span>Diagnostics</span><strong>{expertAnalysis.diagnostics.length}</strong></div><div><span>Output tables</span><strong>{expertAnalysis.operations.filter((operation) => operation.table).length}</strong></div></div>
          <label className="analysisQuestion">Ask Copilot about this result<textarea value={expertQuestion} onChange={(event) => setExpertQuestion(event.target.value)} placeholder="For example: explain the mismatches and validation risks" /></label>
          <button className="secondaryButton" type="button" disabled={isAskingExpert || !expertQuestion.trim()} onClick={() => void askCopilotAboutExpertResult()}><Bot size={16} /> {isAskingExpert ? "Asking Copilot..." : "Ask Copilot"}</button>
          <button className="secondaryButton" type="button" onClick={() => void downloadExpertReport("markdown")}><FileSpreadsheet size={16} /> Download Markdown</button>
          <button className="secondaryButton" type="button" onClick={() => void downloadExpertReport("csv")}><FileSpreadsheet size={16} /> Download CSV</button>
          {expertArtifacts.map((artifact) => <a className="secondaryButton" href={artifact.downloadUrl} download={artifact.fileName} key={artifact.id}><FileSpreadsheet size={16} /> Download {artifact.fileName}</a>)}
          {expertReportStatus ? <p className="muted">{expertReportStatus}</p> : null}
          {expertExplanation ? <div className="copilotExplanation"><h3>Copilot explanation</h3><p>{expertExplanation}</p></div> : null}
          {expertAnalysis.operations.map((operation) => <article className="analysisFile" key={operation.operationId}>
            <strong>{operation.operationId}</strong>
            <span>{JSON.stringify(operation.facts)}</span>
            <span>{operation.diagnostics.map((diagnostic) => diagnostic.message).join(" | ") || "No diagnostics"}</span>
            {operation.table ? <div className="analysisTable"><table><thead><tr>{operation.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{operation.table.rows.map((row, rowIndex) => <tr key={`${operation.operationId}-${rowIndex}`}>{operation.table?.headers.map((header) => <td key={header}>{String(row[header] ?? "")}</td>)}</tr>)}</tbody></table></div> : null}
          </article>)}
        </> : null}
      </section>

      <section className="panel jobsPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Run history</p>
          {expertClarificationQuestions.length > 0 ? <div className="analysisFile">
            <strong>Copilot needs clarification</strong>
            <ol>{expertClarificationQuestions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ol>
            <label className="analysisQuestion">Your answer<textarea value={expertClarificationAnswer} onChange={(event) => setExpertClarificationAnswer(event.target.value)} placeholder="Add the missing detail" /></label>
            <button className="secondaryButton" type="button" disabled={isRunningExpert || !expertClarificationAnswer.trim()} onClick={submitExpertClarification}>Answer and continue</button>
            <button className="secondaryButton" type="button" onClick={() => {
              setExpertClarificationQuestions([]);
              setExpertClarificationAnswer("");
              setExpertStatus("Clarification cancelled.");
            }}>Cancel</button>
          </div> : null}
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
              <p className="usageLine">Usage: {formatJobUsage(job)}</p>
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
    let message = `${url} failed: ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function asJobs(value: unknown): RunnerJob[] {
  return Array.isArray(value) ? value as RunnerJob[] : [];
}

/**
 * Resolves a natural-language run command to a test case: a TC id (5+ digits),
 * an ordinal word ("first", "last"), or a position number ("10th", "case 10").
 */
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

function formatPremiumRequestCost(jobs: RunnerJob[]): string {
  const cost = jobs.reduce((total, job) => total + (job.usage?.premiumRequestCost ?? 0), 0);
  return jobs.some((job) => job.usage?.premiumRequestCost !== undefined) ? cost.toFixed(2) : "Not reported";
}

function formatAiCredits(jobs: RunnerJob[]): string {
  const credits = jobs.reduce((total, job) => total + (job.usage?.aiCreditsUsed ?? 0), 0);
  return jobs.some((job) => job.usage?.aiCreditsUsed !== undefined) ? credits.toFixed(6) : "Not reported";
}

function formatTokens(jobs: RunnerJob[]): string {
  const tokens = jobs.reduce((total, job) => total + (job.usage?.totalTokens ?? 0), 0);
  return jobs.some((job) => job.usage?.totalTokens !== undefined) ? `${tokens.toLocaleString()}` : "Not reported";
}

function formatTokenBreakdown(jobs: RunnerJob[]): string {
  const input = jobs.reduce((total, job) => total + (job.usage?.inputTokens ?? 0), 0);
  const output = jobs.reduce((total, job) => total + (job.usage?.outputTokens ?? 0), 0);
  return jobs.some((job) => job.usage?.inputTokens !== undefined || job.usage?.outputTokens !== undefined)
    ? `Input ${input.toLocaleString()} / output ${output.toLocaleString()}`
    : "Run a new job to record tokens";
}

function formatJobUsage(job: RunnerJob): string {
  if (!job.usage?.reported) {
    return "Not reported by SDK";
  }
  const tokens = job.usage.totalTokens !== undefined ? `${job.usage.totalTokens.toLocaleString()} tokens` : "tokens unavailable";
  const credits = job.usage.aiCreditsUsed !== undefined ? `${job.usage.aiCreditsUsed.toFixed(6)} AI credits` : "AI credits unavailable";
  const cost = job.usage.premiumRequestCost !== undefined ? `${job.usage.premiumRequestCost.toFixed(2)} premium cost` : "premium cost unavailable";
  return `${tokens}; ${credits}; ${cost}`;
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

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_UPLOAD_FILES = 20;

function createFileFormData(files: File[], fields: Record<string, string> = {}): FormData {
  if (files.length === 0) {
    throw new Error("Choose at least one file.");
  }
  if (files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Choose no more than ${MAX_UPLOAD_FILES} files at a time.`);
  }
  const oversizedFile = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  if (oversizedFile) {
    throw new Error(`${oversizedFile.name} exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB per-file limit.`);
  }
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file, file.name));
  Object.entries(fields).forEach(([name, value]) => formData.append(name, value));
  return formData;
}

function splitCommaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
