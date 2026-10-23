# OIC Copilot Runner

Local web app that turns Excel test cases into Oracle OIC (Fusion Incentive Compensation) Java/TestNG Playwright automation jobs using the GitHub Copilot SDK and the existing `.github` agent workflow in this repository.

## Current vertical slice

- Reads the workbook at `src/test/resources/testdata/OIC_TestData.xlsx` (override with `OIC_RUNNER_WORKBOOK_PATH`).
- Normalizes workbook rows into test-case records with source workbook, sheet, and row metadata.
- Shows a local dashboard for selecting a test case.
- Creates a persistent job record under `data/jobs/`.
- Prepares the Copilot SDK generation prompt from the existing OIC generator agent, prompt, and skill files.
- Starts a background Copilot SDK session for the selected test case.
- Discovers the workspace MCP/config files, including `.vscode/mcp.json`.
- Streams assistant, tool, permission, and error events into the persisted job log.
- Uses an allowlisted permission policy for shell commands, file writes, MCP calls, and URL access.

## Transaction analysis API

The runner also accepts up to 20 transaction data files, including `.csv`, `.xlsx`,
and `.zip` archives containing those formats. ZIP members and XLSX worksheets are
expanded before the deterministic analyzer counts non-empty transaction numbers
and sums `transaction amount (source currency)` with exact decimal arithmetic.

```json
POST /api/transaction-analysis
{
	"files": [
		{ "fileName": "orders.csv", "contentBase64": "..." }
	]
}
```

`POST /api/transaction-analysis/copilot` accepts the same payload plus an optional
`question`. Copilot receives the deterministic result through a read-only SDK tool
and explains it without recalculating totals or converting currencies.

## Excel Expert fallback

Excel Expert runs supported operations in the local TypeScript registry first and
asks clarification questions before running when required details are ambiguous.
Only clear requests outside that registry use a per-session Copilot SDK fallback
with the pinned `mbeps/excel-mcp` server. The fallback stages copies of CSV/XLSX
inputs (including supported ZIP members). MCP tool schemas may be discovered, but
a pre-tool allowlist permits only configured read/analysis operations; CSV input is
limited to `csv_ops` preview. Conversion/write actions, output paths, and paths
outside staging are denied. Only temporary staged copies of uploads are passed to
the MCP session; the Excel fallback disables the Playwright MCP and does not expose
Excel MCP to Oracle automation sessions.

The first fallback run uses `uvx` to fetch the pinned Git commit and provision its
Python 3.12+ runtime and dependencies; network access is required. The server
supports multi-file analysis, but it is a file-processing engine rather than the
desktop Excel calculation engine. Results are labeled MCP-derived and are not
reported as locally verified or as Excel-engine recalculations.

Excel MCP execution is bounded per request. Defaults are 24 MCP calls, 2
recovery calls after failures, 3 consecutive failures, and a 5-minute wall-clock
window starting at the first Excel MCP attempt. A recovery is counted only when
an MCP execution has failed and a subsequent MCP call is admitted. Ordinary
call, recovery, or consecutive-failure exhaustion denies that MCP call in the
SDK pre-tool hook and returns the reason to Copilot; Copilot chooses how to
continue. `session.abort()` is reserved for the hard MCP deadline when an MCP
tool is in flight. Override the limits with `OIC_RUNNER_MCP_MAX_CALLS`,
`OIC_RUNNER_MCP_MAX_RECOVERIES`, `OIC_RUNNER_MCP_MAX_CONSECUTIVE_FAILURES`, and
`OIC_RUNNER_MCP_MAX_DURATION_MS` (milliseconds). Invalid values use the defaults.

## Run locally

```powershell
cd apps/oic-copilot-runner
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Local data and teammates

The repository shares the runner source code, package files, prompts, agents, and the Java test framework. It does not share local runtime folders such as `data/jobs/`, `data/auth/`, `data/browser-profile/`, `data/copilot-home/`, `data/workbooks/`, `dist-client/`, or `dist-server/`.

Those folders are ignored because they contain generated build output, browser profiles, auth storage-state JSON, uploaded Excel workbooks, Copilot session logs, and per-machine job history. They can include tenant/account data and can grow very large. When a teammate clones the repo and runs the app, the server recreates the needed folders automatically. Each teammate should sign in locally, upload or place their own workbook, and run `npm run build` or `npm run dev` to generate local bundles.

## Current autonomous flow

1. Select a normalized Excel test case in the dashboard.
2. Choose `Run autonomously`.
3. The API creates a queued job and immediately starts a background Copilot SDK session.
4. The prompt instructs Copilot to generate Oracle OIC Java/TestNG Playwright automation, externalize environment data, run the repository validation, and run focused Maven checks when possible.
5. The dashboard polls `/api/jobs` and shows live job status and logs.

## Next implementation slices

1. Add explicit generated-file artifact detection and links in the job cards.
2. Add a dedicated validation phase after SDK generation for deterministic `mvn compile` and focused `mvn test` evidence.
3. Invoke the locator-healer workflow automatically for failed Playwright locator runs.
4. Add a stop/cancel button for long-running Copilot sessions.

## Safety boundaries

The runner is designed to be autonomous but allowlisted. It should allow reads across the repo, writes only to generated Java test areas and knowledge logs, and shell commands only for build, validation, and focused test execution. Destructive git commands and broad file writes are denied.
