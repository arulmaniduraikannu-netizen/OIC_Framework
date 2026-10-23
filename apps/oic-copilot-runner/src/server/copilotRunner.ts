import fs from "node:fs/promises";
import path from "node:path";
import { CopilotClient, ToolSet } from "@github/copilot-sdk";
import type { MCPServerConfig, PermissionHandler, PermissionRequest, SessionEvent } from "@github/copilot-sdk";
import type { ExcelAnalysisResult, NormalizedTestCase, RunProfile, RunnerJob, RunnerUsage } from "../shared/types.js";
import { closeOicBrowserPreflight, loginOic } from "./browserPreflight.js";
import { paths, settings } from "./config.js";
import { canRunCommand, canWriteFile, toRepoRelativePath } from "./permissionPolicy.js";
import { createRunnerTools, createExcelAnalysisTool, createTransactionAnalysisTool } from "./runnerTools.js";
import { writeJobReport } from "./reportGenerator.js";
import { runExistingTest } from "./testExecutor.js";
import { findExistingTestCase, type ExistingTestCaseMatch } from "./testDiscovery.js";
import type { TransactionRowsInput } from "./transactionAnalysis.js";
import { analyzeTransactionBatch } from "./transactionAnalysis.js";

type JobUpdateHandler = (job: RunnerJob) => Promise<void>;
type PreToolUseInput = {
  toolName: string;
  toolArgs: unknown;
};

const activeCopilotRuns = new Map<string, { client: CopilotClient; session?: { abort(): Promise<void> } }>();
const cancelledJobIds = new Set<string>();

export async function buildGenerationPrompt(testCase: NormalizedTestCase): Promise<string> {
  const steps = testCase.steps && testCase.steps.length > 0 ? testCase.steps : [testCase.title];
  const scenario = {
    id: testCase.id,
    title: testCase.title,
    feature: testCase.feature,
    preconditions: testCase.preconditions,
    steps,
    expectedResult: testCase.expectedResult,
    sourceWorkbook: testCase.sourceWorkbook,
    sheetName: testCase.sheetName,
    rowNumber: testCase.rowNumber
  };

  return [
    "Run the Oracle OIC `/oic-test` workflow for this Excel scenario, but stop after Phase 2.",
    "Treat the Excel scenario as the authoritative workflow. When its ordered steps and expected result are sufficient, skip Phase 1 and begin directly with Phase 2.",
    "Perform only targeted Phase 1 Oracle research when a step is ambiguous, missing navigation context, contains an unknown Oracle term, or conflicts with the expected result. Record only the research needed to resolve that uncertainty and any remaining unresolved question.",
    "Phase 2: use the connected Playwright MCP browser to inspect the signed-in Oracle Fusion portal live. Execute the scenario steps in order, snapshot after meaningful actions, and produce a concrete locator contract for every step with role, accessible name or visible label, sequence, and observed fallback.",
    "Do not start Phase 3. Do not generate or edit Java/page-object/test files. Do not run Maven, compile commands, or repository validation. Return the Phase 1 and Phase 2 handoff only.",
    "Do not browse repository instructions, agents, skills, or unrelated source files unless the targeted Phase 1 research is necessary to resolve a specific uncertainty.",
    "Never guess a URL, workflow, locator, or result. If authentication, tenant access, or portal state blocks progress, stop and report the exact blocker.",
    "Use durable role/label/text locators from live accessibility snapshots. Do not use force clicks, raw JavaScript, ephemeral snapshot references, CSS indexes, or hard waits.",
    "Use the exact Excel values and steps below. Keep the handoff compact: summarize snapshots and evidence instead of returning full page trees or chat history.",
    "",
    "## Excel scenario",
    JSON.stringify(scenario, null, 2),
    "",
    "## Required handoff",
    "📚 Phase 1 — Domain Research",
    "🌐 Phase 2 — Playwright locator contract",
    "Return unresolved questions and the exact stopping reason if either phase cannot complete."
  ].join("\n");
}

/**
 * Fallback prompt used when a compiled test fails at a step. Instead of editing a
 * single locator and re-running the whole compiled test, this drives the ENTIRE
 * scenario live end-to-end in ONE Playwright MCP browser — self-correcting the
 * failing step inline (continuing in the same browser, not restarting) — then
 * updates the existing test with snapshot-verified locators.
 */
export async function buildLiveDriveFallbackPrompt(testCase: NormalizedTestCase, match: ExistingTestCaseMatch, testOutput: string): Promise<string> {
  const generation = await buildGenerationPrompt(testCase);
  return [
    "A compiled Oracle OIC Java/TestNG Playwright test already exists for this Excel test case but it FAILED at one step during the Maven test run (output below).",
    "Do NOT just change one locator and re-run the compiled test. Instead, COMPLETE THE ENTIRE SCENARIO LIVE IN A SINGLE BROWSER SESSION now, then update the existing test at the end.",
    "Hard rules for this one-browser fallback run:",
    "  - Drive the whole scenario end-to-end in ONE Playwright MCP browser, from the first Excel step to the last, in order, using the exact values from each step.",
    "  - COVER EVERY EXCEL STEP — NO SHORTCUTS. Walk each step explicitly and take a browser_snapshot at each, even if a later step's goal already looks satisfied on the current screen. In particular, if the case says create the item then select it from the list then open its details, you MUST go BACK to the list, find it, and click it — do not skip that step just because Save left you on the item's page. List/selection and each verification are real steps that must be walked and snapshot-verified.",
    "  - When a step's locator does not match, you are ALREADY on that page — take a browser_snapshot, find the real element, act on it, and CONTINUE to the next step in the SAME browser. Never restart the browser or replay the scenario from step 1.",
    "  - POINTER INTERCEPTION (ADF / Oracle Fusion): if a browser_click on a checkbox/toggle fails or times out with 'subtree intercepts pointer events' (an icon overlays the real <input>), do NOT keep clicking the raw <input>. Click the associated LABEL, the selection ROW, or the semantic role element by accessible name instead. Write the resulting test locator the same way — target the row/label/role (GetByRole Row/Checkbox by Name), never the hidden input.",
    "  - DURABLE LOCATORS ONLY — what passes LIVE must also pass a COLD compiled run. browser_run_code_unsafe, raw JS/evaluate, force clicks, ephemeral snapshot refs (aria-ref=...), CSS/nth-child index selectors, and raw page.locator('...').first() are LIVE-DRIVE crutches: they can make a click work in the moment but they are NOT allowed in the test you write. Before you write ANY locator into the test, you MUST re-perform that same action in the live browser using the exact durable Playwright locator you intend to write (prefer GetByRole/GetByLabel with an accessible Name, scoped to the correct FrameLocator) and confirm it acts on the right element WITHOUT any JS/force. If you only got it working via run_code_unsafe/force, you have NOT found the real locator yet — keep snapshotting until a plain role/label locator works, and write THAT. Never translate a JS/force live hack into a naive click in the test.",
    "  - Add explicit web-first waits for slow portal surfaces: before acting inside an ADF page/iframe, expect the frame element or first field to be visible with a 60s timeout so a cold compiled run does not race the ADF page load.",
    "  - Finish the run in this single browser pass so the whole test case is exercised live to completion.",
    "  - Then UPDATE THE EXISTING test files identified below (do NOT create a duplicate test or page object) so EVERY step you walked — including the list/selection and verification steps — is written back with its snapshot-verified locator, following the workspace locator + anti-flakiness rules. Make list-row/selection locators robust against duplicate same-named items.",
    "  - Only stop early if the Maven output below shows a genuine auth/ENV redirect (login page / Oracle sign-in / session expiry). Otherwise you MUST complete the scenario and fix the test.",
    "  - You MAY consult .github/oic-knowledge.md as a STARTING HINT for a workflow or locator, but it is a cache that can be STALE (it has caused iframe-name errors before). Every locator you write MUST be confirmed against a live browser_snapshot in THIS session — the live snapshot always wins over the cache. After you verify something new or correct a stale entry, update .github/oic-knowledge.md so it improves for next time.",
    "  - Your edits will be VERIFIED: after you finish, the runner re-runs the compiled Maven test. If any step still fails, you will be called again with that exact failure. So make every step's locator robust enough to pass a real compiled run, not just a live click.",
    "",
    "## Existing compiled test that failed (UPDATE this in place — do not duplicate)",
    JSON.stringify(match, null, 2),
    "",
    "## Maven test output (the step where it failed)",
    testOutput,
    "",
    "## Full generate-and-drive workflow (follow all of it for the live run and the test update)",
    generation
  ].join("\n");
}

function getRunProfile(job: RunnerJob): RunProfile {
  return job.runProfile ?? {
    portalUrl: "https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome",
    tenantName: "",
    username: "",
    storageStatePath: "",
    notes: ""
  };
}

export async function runAutonomousJob(job: RunnerJob, onUpdate: JobUpdateHandler, password?: string): Promise<RunnerJob> {
  let current = await updateJob(job, onUpdate, {
    status: "running",
    phase: "Starting OIC test generation",
    log: [`Running the OIC generate-and-drive workflow for TC${job.testCase.id}. Live-driving the Oracle Fusion portal with the Playwright MCP browser.`]
  });

  // Authenticate before starting Copilot so one click always runs in a
  // verified browser session.
  let runProfile = getRunProfile(current);
  if (!password || !runProfile.username) {
    return updateJob(current, onUpdate, {
      status: "blocked",
      phase: "Authentication required",
      log: ["Run blocked before Copilot: enter both Username and Password, then run the test again."]
    });
  }

  if (password && runProfile.username) {
    current = await updateJob(current, onUpdate, {
      phase: "Signing in to Oracle Fusion",
      log: [`Signing in as ${runProfile.username} before running…`]
    });
    try {
      const result = await loginOic(runProfile.username, password);
      if (!result.signedIn) {
        await closeOicBrowserPreflight();
        return updateJob(current, onUpdate, {
          status: "blocked",
          phase: "Authentication blocked",
          log: [result.message, "Run stopped before Copilot because Oracle authentication was not confirmed."]
        });
      }
      current = await updateJob(current, onUpdate, {
        runProfile: { ...runProfile, storageStatePath: result.storageStatePath ?? runProfile.storageStatePath },
        log: [result.message]
      });
    } catch (error) {
      await closeOicBrowserPreflight();
      return updateJob(current, onUpdate, {
        status: "blocked",
        phase: "Authentication failed",
        log: [`Sign-in failed before Copilot: ${error instanceof Error ? error.message : String(error)}`]
      });
    }
    await closeOicBrowserPreflight();
  }

  return runCopilotJob(current, onUpdate);
}

export async function runCopilotJob(job: RunnerJob, onUpdate: JobUpdateHandler): Promise<RunnerJob> {
  const prompt = [
    await buildGenerationPrompt(job.testCase),
    "",
    "## Run profile from app UI",
    JSON.stringify(getRunProfile(job), null, 2)
  ].join("\n");

  return runCopilotPrompt(job, onUpdate, prompt, {
    startPhase: "Starting Copilot SDK Phase 1/2 session",
    preparedPhase: "Compact Phase 1/2 prompt prepared",
    sessionPhase: "Copilot SDK Phase 1/2 session running",
    completedPhase: "Phase 1/2 research and UI inspection finished",
    completedStatus: "generated",
    startLog: "Creating a compact Copilot SDK session for Oracle domain research and live Playwright locator inspection. Phase 3 code generation is disabled."
  });
}

/**
 * Fast path: runs the already-generated compiled test for this case via
 * `mvn test` instead of regenerating it. If no test authoritatively owns the
 * case id, the job is marked blocked with a clear "generate it first" message —
 * it never runs an unrelated test.
 */
export async function runExistingTestJob(job: RunnerJob, onUpdate: JobUpdateHandler, password?: string): Promise<RunnerJob> {
  let current = await updateJob(job, onUpdate, {
    status: "running",
    phase: "Locating existing compiled test",
    log: [`Looking for an existing compiled test that owns TC${job.testCase.id}.`]
  });

  const match = await findExistingTestCase(job.testCase.id);
  if (!match) {
    return updateJob(current, onUpdate, {
      status: "blocked",
      phase: "No existing test found",
      log: [`No existing test found for TC#${job.testCase.id}. Generate it first, then run existing.`]
    });
  }

  const runProfile = getRunProfile(current);
  // Sign in first so the Java test starts authenticated (it uses OIC_STORAGE_STATE).
  if (password && runProfile.username) {
    current = await updateJob(current, onUpdate, {
      phase: "Signing in to Oracle Fusion",
      log: [`Signing in as ${runProfile.username} to authenticate the test browser…`]
    });
    try {
      const result = await loginOic(runProfile.username, password);
      if (result.storageStatePath) {
        runProfile.storageStatePath = result.storageStatePath;
      }
      if (!result.signedIn) {
        await closeOicBrowserPreflight();
        return finalizeExistingTestJob(await updateJob(current, onUpdate, {
          status: "blocked",
          phase: "Authentication blocked",
          log: [result.message, "Run stopped before Maven because Oracle authentication was not confirmed."]
        }), onUpdate);
      }
      current = await updateJob(current, onUpdate, { runProfile, log: [result.message] });
    } catch (error) {
      await closeOicBrowserPreflight();
      return finalizeExistingTestJob(await updateJob(current, onUpdate, {
        status: "blocked",
        phase: "Authentication failed",
        log: [`Sign-in failed before Maven: ${error instanceof Error ? error.message : String(error)}`]
      }), onUpdate);
    }
    await closeOicBrowserPreflight();
  }

  current = await updateJob(current, onUpdate, {
    phase: "Running existing compiled test",
    log: [`Found ${match.relativePath} → ${match.fullyQualifiedName}. Running via mvn test…`]
  });

  const result = await runExistingTest(match, runProfile);
  const passed = result.exitCode === 0;
  current = await updateJob(current, onUpdate, {
    status: passed ? "passed" : "running",
    phase: passed ? "Existing test passed" : "Existing test failed — triaging",
    artifacts: [...current.artifacts, { label: `mvn test (${match.methodName})`, path: match.relativePath, kind: "test-result" }],
    log: [`Command: ${result.command}`, `Exit code: ${result.exitCode}`, trimForLog(result.output)]
  });

  if (passed) {
    return finalizeExistingTestJob(current, onUpdate);
  }

  // Auth/environment failures (the Maven output itself redirected to the
  // Oracle sign-in page) are NOT locator problems — never live-drive those.
  const authFailure = /signin|login\.us2\.oraclecloud\.com|session\s+expired|sign in to your account|AADSTS|correlation id/i.test(result.output);
  if (authFailure) {
    current = await updateJob(current, onUpdate, {
      status: "blocked",
      phase: "Existing test failed — auth/environment",
      log: ["The test stopped at the Oracle sign-in page (auth/ENV), not a locator issue. Sign in and retry — skipping live-drive so locators are not changed for a sign-in problem."]
    });
    return finalizeExistingTestJob(current, onUpdate);
  }

  // Locator / code / step failure → single-browser live-drive that runs the whole
  // scenario and fixes locators from live snapshots, THEN we VERIFY by re-running the
  // compiled test. If a later step still fails, feed that exact failure back and
  // live-verify again — bounded — so the run only ends when the test actually passes.
  const maxPasses = Number(process.env.OIC_MAX_LIVEDRIVE_PASSES) || 3;
  let failureOutput = result.output;

  for (let pass = 1; ; pass++) {
    current = await updateJob(current, onUpdate, {
      status: "running",
      phase: `Live-driving the full scenario in one browser (pass ${pass} of ${maxPasses})`,
      log: [pass === 1
        ? "Existing test failed at a step. Handing off to a single Copilot + Playwright MCP browser: it runs the ENTIRE scenario live end-to-end, self-corrects inline, and updates the test with snapshot-verified locators."
        : `The compiled test still failed at a step. Live-driving again (pass ${pass}) to verify and fix that exact step from a fresh live snapshot.`]
    });

    const liveDrivePrompt = [
      await buildLiveDriveFallbackPrompt(job.testCase, match, failureOutput),
      "",
      "## Run profile from app UI",
      JSON.stringify(runProfile, null, 2)
    ].join("\n");

    current = await runCopilotPrompt(current, onUpdate, liveDrivePrompt, {
      startPhase: `Starting live-drive fallback (pass ${pass})`,
      preparedPhase: "Live-drive prompt prepared",
      sessionPhase: "Live-driving the portal end-to-end in one browser and fixing the test",
      completedPhase: "Live-drive pass finished — verifying by re-running the test",
      completedStatus: "running",
      startLog: "Creating a Copilot SDK session to complete the whole scenario live in one browser."
    });

    // VERIFY: run the compiled test to prove the live-drive's edits actually work.
    current = await updateJob(current, onUpdate, {
      status: "running",
      phase: "Verifying the live-drive fix by re-running the compiled test",
      log: ["Live-drive pass finished. Re-running the compiled test to verify the code actually passes…"]
    });
    const verify = await runExistingTest(match, runProfile);
    const verifyPassed = verify.exitCode === 0;
    current = await updateJob(current, onUpdate, {
      status: verifyPassed ? "passed" : "running",
      phase: verifyPassed ? "Existing test passed" : `Live-drive verified: still failing (after pass ${pass})`,
      log: [`Verify command: ${verify.command}`, `Exit code: ${verify.exitCode}`, trimForLog(verify.output)]
    });

    if (verifyPassed) {
      current = await updateJob(current, onUpdate, {
        log: [`Live-drive succeeded after ${pass} pass(es): the compiled test now passes.`]
      });
      return finalizeExistingTestJob(current, onUpdate);
    }

    // Auth/ENV regression on the re-run → stop, don't live-drive a sign-in problem.
    if (/signin|login\.us2\.oraclecloud\.com|session\s+expired|sign in to your account|AADSTS|correlation id/i.test(verify.output)) {
      current = await updateJob(current, onUpdate, {
        status: "blocked",
        phase: "Verification blocked — auth/environment",
        log: ["The re-run hit the Oracle sign-in page (auth/ENV). Stopping — sign in and retry."]
      });
      return finalizeExistingTestJob(current, onUpdate);
    }

    if (pass >= maxPasses) {
      current = await updateJob(current, onUpdate, {
        status: "failed",
        phase: "Live-drive exhausted",
        log: [`Live-drove ${pass} time(s); the compiled test still fails. See the last Maven output above — this step needs manual review or a stabler locator.`]
      });
      return finalizeExistingTestJob(current, onUpdate);
    }

    // Feed the NEW failure into the next targeted pass.
    failureOutput = verify.output;
  }
}

async function finalizeExistingTestJob(job: RunnerJob, onUpdate: JobUpdateHandler): Promise<RunnerJob> {
  let current = job;
  try {
    const report = await writeJobReport(current);
    current = await updateJob(current, onUpdate, {
      artifacts: [...current.artifacts, report],
      log: [`Extent report generated. Open it at /api/reports/${current.id}`]
    });
  } catch (error) {
    current = await updateJob(current, onUpdate, {
      log: [`Report generation warning: ${error instanceof Error ? error.message : String(error)}`]
    });
  }

  return current;
}

async function runCopilotPrompt(
  job: RunnerJob,
  onUpdate: JobUpdateHandler,
  prompt: string,
  labels: {
    startPhase: string;
    preparedPhase: string;
    sessionPhase: string;
    completedPhase: string;
    completedStatus: RunnerJob["status"];
    startLog: string;
  }
): Promise<RunnerJob> {
  let current = await updateJob(job, onUpdate, {
    status: "running",
    phase: labels.startPhase,
    log: [labels.startLog]
  });

  current = await updateJob(current, onUpdate, {
    status: "running",
    phase: labels.preparedPhase,
    log: [`Prepared generation prompt (${prompt.length.toLocaleString()} chars).`]
  });

  const client = await createCopilotClient();
  activeCopilotRuns.set(job.id, { client });

  try {
    await fs.mkdir(paths.copilotHomePath, { recursive: true });
    await ensureCopilotMcpConfig();
    await closeOicBrowserPreflight();
    current = await updateJob(current, onUpdate, {
      phase: "Preparing Playwright MCP browser",
      log: ["Closed the login browser (if open). The Playwright MCP browser loads the proven signed-in storage state in an isolated context so it starts authenticated on the Oracle portal (no login-page fallback)."]
    });

    const mcpServers = await loadRunnerMcpServers();
    current = await updateJob(current, onUpdate, {
      log: [
        `Loaded MCP server definitions: ${Object.keys(mcpServers).join(", ") || "none"}`,
        "The generator will live-drive the Oracle portal using the full Playwright MCP browser toolset (navigate, snapshot, click, type, fill, upload)."
      ]
    });

    const session = await client.createSession({
      clientName: "oic-copilot-runner",
      model: current.model || settings.model,
      workingDirectory: settings.repoRoot,
      configDirectory: settings.repoRoot,
      enableConfigDiscovery: true,
      tools: createRunnerTools(),
      skillDirectories: [path.join(settings.repoRoot, ".github", "skills")],
      availableTools: new ToolSet().addBuiltIn("*").addMcp("*").addCustom("*"),
      streaming: true,
      onPermissionRequest: createPermissionHandler(async (line) => {
        current = await updateJob(current, onUpdate, { log: [line] });
      }),
      hooks: {
        onPreToolUse: async (input) => preflightToolUse(input),
        onPreMcpToolCall: async (input) => {
          current = await updateJob(current, onUpdate, { log: [`MCP tool requested: ${input.serverName}/${input.toolName}`] });
        },
        onPostToolUse: async (input) => {
          current = await updateJob(current, onUpdate, { log: [`Tool completed: ${input.toolName}`] });
        },
        onPostToolUseFailure: async (input) => {
          current = await updateJob(current, onUpdate, { log: [`Tool failed: ${input.toolName}: ${input.error}`] });
          return {
            additionalContext: "Use the actual failure message to repair the same Oracle OIC test-generation slice before expanding scope."
          };
        }
      }
    });
    const activeRun = activeCopilotRuns.get(job.id);
    if (activeRun) {
      activeRun.session = session;
    }

    current = await updateJob(current, onUpdate, {
      status: "running",
      phase: labels.sessionPhase,
      log: [`Session created: ${session.sessionId}`]
    });

    let sessionHadActivity = false;
    let eventUpdates = Promise.resolve();
    session.on((event) => {
      if (["assistant.message", "assistant.message_delta", "tool.execution_start", "tool.execution_complete"].includes(event.type)) {
        sessionHadActivity = true;
      }
      eventUpdates = eventUpdates.then(() => appendSessionEvent(current, event, async (logLine) => {
        current = await updateJob(current, onUpdate, { log: [logLine] });
      }));
    });

    current = await updateJob(current, onUpdate, { log: ["Prompt sent to generator."] });
    // Run until the model finishes the scenario (session goes idle). The large
    // timeout is only a safety cap so a genuinely stuck run cannot hang forever;
    // it is not a hard step budget. Configurable via OIC_RUNNER_SESSION_TIMEOUT_MS.
    const sessionTimeoutMs = Number(process.env.OIC_RUNNER_SESSION_TIMEOUT_MS) || 120 * 60 * 1000;
    const result = await session.sendAndWait({ prompt, mode: "immediate" }, sessionTimeoutMs);
    await eventUpdates;
    const metrics = await readSessionUsage(session);
    if (metrics) {
      current = await updateJob(current, onUpdate, { usage: metrics });
    }
    await session.disconnect();
    const finalContent = result?.data.content ?? "";
    const blocked = /\bblocked\b|does not expose the required|cannot complete|can't complete/i.test(finalContent);
    const noActivity = !sessionHadActivity && !finalContent.trim();

    current = await updateJob(current, onUpdate, {
      status: noActivity ? "failed" : blocked ? "blocked" : labels.completedStatus,
      phase: noActivity ? "Copilot SDK run failed — no activity" : blocked ? "Copilot SDK run blocked" : labels.completedPhase,
      log: [noActivity
        ? "Copilot SDK became idle without an assistant response or tool activity; the test case was not run."
        : finalContent ? `Final assistant response: ${trimForLog(finalContent)}` : "Copilot SDK run finished without a final assistant message."]
    });
  } catch (error) {
    current = await updateJob(current, onUpdate, {
      status: "failed",
      phase: "Copilot SDK run failed",
      log: [error instanceof Error ? error.message : String(error)]
    });
  } finally {
    activeCopilotRuns.delete(job.id);
    const stopErrors = await client.stop();
    if (stopErrors.length > 0) {
      current = await updateJob(current, onUpdate, {
        log: stopErrors.map((error) => `SDK cleanup warning: ${error.message}`)
      });
    }
  }

  try {
    const report = await writeJobReport(current);
    current = await updateJob(current, onUpdate, {
      artifacts: [...current.artifacts, report],
      log: [`Extent report generated. Open it at /api/reports/${current.id}`]
    });
  } catch (error) {
    current = await updateJob(current, onUpdate, {
      log: [`Report generation warning: ${error instanceof Error ? error.message : String(error)}`]
    });
  }

  return current;
}

export async function createCopilotClient(): Promise<CopilotClient> {
  return new CopilotClient({
    workingDirectory: settings.repoRoot,
    baseDirectory: paths.copilotHomePath,
    mode: "copilot-cli",
    logLevel: "info",
    useLoggedInUser: true
  });
}

export async function explainTransactionAnalysis(inputs: TransactionRowsInput[], question: string): Promise<{ analysis: ReturnType<typeof analyzeTransactionBatch>; response: string }> {
  const analysis = analyzeTransactionBatch(inputs);
  const client = await createCopilotClient();
  try {
    const session = await client.createSession({
      clientName: "oic-transaction-analysis",
      model: settings.model,
      workingDirectory: settings.repoRoot,
      configDirectory: settings.repoRoot,
      enableConfigDiscovery: true,
      tools: [createTransactionAnalysisTool(analysis)],
      availableTools: new ToolSet().addCustom("*")
    });
    try {
      const result = await session.sendAndWait({
        prompt: [
          "Explain the deterministic transaction analysis returned by the transaction_analysis_result tool.",
          "Do not recalculate, infer missing amounts, convert currencies, or change any result values.",
          "Mention file-level totals, invalid or blank amount diagnostics, and mixed-currency warnings when present.",
          `User question: ${question.trim() || "Summarize the transaction count and source-currency amount total."}`
        ].join("\n"),
        mode: "immediate"
      }, Number(process.env.OIC_RUNNER_ANALYSIS_TIMEOUT_MS) || 120000);
      return { analysis, response: result?.data.content ?? "The analysis completed without an assistant summary." };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  } finally {
    await client.stop().catch(() => undefined);
  }
}

export async function explainExcelAnalysis(analysis: ExcelAnalysisResult, question: string): Promise<{ response: string }> {
  const client = await createCopilotClient();
  try {
    const session = await client.createSession({
      clientName: "oic-excel-analysis",
      model: settings.model,
      workingDirectory: settings.repoRoot,
      configDirectory: settings.repoRoot,
      enableConfigDiscovery: true,
      tools: [createExcelAnalysisTool(analysis)],
      availableTools: new ToolSet().addCustom("*")
    });
    try {
      const result = await session.sendAndWait({
        prompt: [
          "Explain the deterministic Excel analysis returned by the excel_analysis_result tool.",
          "Do not recalculate, infer missing values, invent rows, or change any result values.",
          "Mention the operations performed, important facts, validation diagnostics, and comparison outcomes when present.",
          `User question: ${question.trim() || "Summarize the workbook analysis and any data-quality issues."}`
        ].join("\n"),
        mode: "immediate"
      }, Number(process.env.OIC_RUNNER_ANALYSIS_TIMEOUT_MS) || 120000);
      return { response: result?.data.content ?? "The analysis completed without an assistant summary." };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  } finally {
    await client.stop().catch(() => undefined);
  }
}

/**
 * Resolves the signed-in Playwright storage-state the generator's MCP browser should
 * load so it starts authenticated on the Oracle portal (the same proven state the
 * Java test uses). Falls back to OIC_STORAGE_STATE, then the newest saved
 * oic-state file. Returns undefined if none exists.
 */
async function resolvePlaywrightStorageState(): Promise<string | undefined> {
  const fromEnv = process.env.OIC_STORAGE_STATE;
  if (fromEnv) {
    try {
      await fs.access(fromEnv);
      return fromEnv;
    } catch {
      // fall through to the newest saved state
    }
  }
  try {
    const files = (await fs.readdir(paths.authPath))
      .filter((file) => file.startsWith("oic-state-") && file.endsWith(".json"));
    let newest: { path: string; mtime: number } | undefined;
    for (const file of files) {
      const full = path.join(paths.authPath, file);
      const stat = await fs.stat(full);
      if (!newest || stat.mtimeMs > newest.mtime) {
        newest = { path: full, mtime: stat.mtimeMs };
      }
    }
    return newest?.path;
  } catch {
    return undefined;
  }
}

async function ensureCopilotMcpConfig(): Promise<void> {
  // The Copilot CLI resolves its home from COPILOT_HOME, which the SDK sets to the
  // client baseDirectory (paths.copilotHomePath) — see copilot-sdk client.js
  // (COPILOT_HOME = baseDirectory) and the CLI's resolveCopilotHome. So the user
  // MCP config must live at <copilotHome>/mcp-config.json, NOT ~/.copilot, or the
  // Playwright servers never load into the session. Merge without clobbering.
  const configDir = paths.copilotHomePath;
  const configPath = path.join(configDir, "mcp-config.json");
  const playwrightCli = path.join(paths.appRoot, "node_modules", "@playwright", "mcp", "cli.js");
  // Load the generator's browser with the proven signed-in storage state in an isolated
  // context. The old --user-data-dir persistent profile lands on the Oracle login
  // page whenever the profile is locked or unauthenticated, which forced the generator
  // to guess locators from the stale cache instead of verifying against the live portal.
  const storageState = await resolvePlaywrightStorageState();
  const browserAuthArgs = storageState
    ? ["--isolated", "--storage-state", storageState]
    : ["--user-data-dir", paths.browserProfilePath];
  const desiredServers = {
    playwright: {
      // Invoke the locally pinned Playwright MCP via an absolute node path.
      // npx resolves a broken alpha from the internal registry, so avoid it.
      command: process.execPath,
      args: [
        playwrightCli,
        "--browser=chrome",
        ...browserAuthArgs,
        "--image-responses=omit",
        "--console-level=error",
        "--viewport-size",
        "1440x900"
      ]
    }
  };

  await fs.mkdir(configDir, { recursive: true });
  let existing: { mcpServers?: Record<string, unknown> } = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, "utf8")) as { mcpServers?: Record<string, unknown> };
  } catch {
    existing = {};
  }
  const merged = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), ...desiredServers }
  };
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));
}

async function loadRunnerMcpServers(): Promise<Record<string, MCPServerConfig>> {
  const raw = JSON.parse(await fs.readFile(settings.mcpConfigPath, "utf8")) as {
    servers?: Record<string, MCPServerConfig>;
  };
  const servers = raw.servers ?? {};
  const playwright = servers.playwright;
  const storageState = await resolvePlaywrightStorageState();

  return Object.fromEntries(
    Object.entries({
      playwright: normalizePlaywrightMcpServer(playwright, storageState)
    }).filter((entry): entry is [string, MCPServerConfig] => Boolean(entry[1]))
  );
}

function normalizePlaywrightMcpServer(server: MCPServerConfig | undefined, storageState?: string): MCPServerConfig | undefined {
  if (!server || !("command" in server)) {
    return server;
  }

  const args = [...(server.args ?? [])];
  if (!args.includes("--browser=chrome") && !args.includes("--browser")) {
    args.push("--browser=chrome");
  }
  // Prefer the proven signed-in storage state in an isolated context so the browser
  // starts authenticated instead of landing on the Oracle login page. Only fall
  // back to the persistent profile when no storage state is available.
  const hasProfile = args.some((arg) => arg.startsWith("--user-data-dir"));
  const hasState = args.includes("--storage-state");
  if (storageState && !hasProfile && !hasState) {
    args.push("--isolated", "--storage-state", storageState);
  } else if (!hasProfile && !hasState) {
    args.push("--user-data-dir", paths.browserProfilePath);
  }
  if (!args.includes("--viewport-size")) {
    args.push("--viewport-size", "1440x900");
  }
  if (!args.includes("--timeout-navigation")) {
    args.push("--timeout-navigation", "120000");
  }

  return {
    ...server,
    type: "local",
    args,
    workingDirectory: settings.repoRoot
  };
}

function createPermissionHandler(log: (line: string) => Promise<void>): PermissionHandler {
  return async (request) => {
    const decision = evaluatePermissionRequest(request);
    await log(`Permission ${decision.allowed ? "allowed" : "denied"}: ${describePermissionRequest(request)}${decision.reason ? ` (${decision.reason})` : ""}`);
    return decision.allowed ? { kind: "approve-once" } : { kind: "reject", feedback: decision.reason };
  };
}

function evaluatePermissionRequest(request: PermissionRequest): { allowed: boolean; reason?: string } {
  switch (request.kind) {
    case "shell":
      return canRunCommand(request.fullCommandText)
        ? { allowed: true }
        : { allowed: false, reason: `Command is outside the runner allowlist: ${request.fullCommandText}` };
    case "write":
      return canWriteFile(request.fileName)
        ? { allowed: true }
        : { allowed: false, reason: `Write path is outside the runner allowlist: ${toRepoRelativePath(request.fileName)}` };
    case "read":
      return { allowed: true };
    case "mcp":
      return request.readOnly || request.serverName.toLowerCase().includes("playwright")
        ? { allowed: true }
        : { allowed: false, reason: `MCP tool is not allowlisted: ${request.serverName}/${request.toolName}` };
    case "url":
      return /^https:\/\/(ecaw-test\.fa\.us2\.oraclecloud\.com|docs\.oracle\.com|github\.com)\b/i.test(request.url)
        ? { allowed: true }
        : { allowed: false, reason: `URL is outside the runner allowlist: ${request.url}` };
    case "memory":
      return { allowed: true };
    default:
      return { allowed: false, reason: `Permission kind is not allowlisted: ${request.kind}` };
  }
}

function preflightToolUse(input: PreToolUseInput): { permissionDecision: "allow" | "deny"; permissionDecisionReason?: string } {
  const args = input.toolArgs && typeof input.toolArgs === "object" ? input.toolArgs as Record<string, unknown> : {};
  const command = typeof args.command === "string" ? args.command : "";
  if (command && !canRunCommand(command)) {
    return { permissionDecision: "deny", permissionDecisionReason: `Command is outside the runner allowlist: ${command}` };
  }

  const filePath = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : "";
  if (filePath && /(?:write|edit|create|delete|patch)/i.test(input.toolName) && !canWriteFile(filePath)) {
    return { permissionDecision: "deny", permissionDecisionReason: `Write path is outside the runner allowlist: ${toRepoRelativePath(filePath)}` };
  }

  return { permissionDecision: "allow" };
}

async function updateJob(job: RunnerJob, onUpdate: JobUpdateHandler, patch: Partial<Pick<RunnerJob, "status" | "phase" | "log" | "artifacts" | "runProfile" | "usage">>): Promise<RunnerJob> {
  const cancelled = cancelledJobIds.has(job.id);
  const updated: RunnerJob = {
    ...job,
    ...patch,
    status: cancelled ? "cancelled" : patch.status ?? job.status,
    phase: cancelled ? "Cancelled by user" : patch.phase ?? job.phase,
    log: [...job.log, ...(patch.log ?? [])],
    artifacts: patch.artifacts ?? job.artifacts,
    updatedAt: new Date().toISOString()
  };
  await onUpdate(updated);
  return updated;
}

async function readSessionUsage(session: unknown): Promise<RunnerUsage | undefined> {
  const usageApi = (session as { rpc?: { usage?: { getMetrics?: () => Promise<Record<string, unknown>> } } }).rpc?.usage;
  if (!usageApi?.getMetrics) {
    return undefined;
  }
  try {
    const metrics = await usageApi.getMetrics();
    const tokenDetails = metrics.tokenDetails as Record<string, { tokenCount?: number } | undefined> | undefined;
    const tokenCount = (name: string): number => tokenDetails?.[name]?.tokenCount ?? 0;
    const inputTokens = tokenCount("input") || tokenCount("inputTokens") || tokenCount("prompt") || numberValue(metrics.lastCallInputTokens);
    const outputTokens = tokenCount("output") || tokenCount("outputTokens") || tokenCount("completion") || numberValue(metrics.lastCallOutputTokens);
    const measuredTotal = Object.values(tokenDetails ?? {}).reduce((total, detail) => total + (detail?.tokenCount ?? 0), 0);
    const totalTokens = measuredTotal || inputTokens + outputTokens;
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      aiCreditsUsed: typeof metrics.totalNanoAiu === "number" ? metrics.totalNanoAiu / 1_000_000_000 : undefined,
      premiumRequestCost: typeof metrics.totalPremiumRequestCost === "number" ? metrics.totalPremiumRequestCost : undefined,
      reported: true
    };
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export async function cancelCopilotJob(jobId: string): Promise<boolean> {
  const activeRun = activeCopilotRuns.get(jobId);
  cancelledJobIds.add(jobId);
  if (!activeRun) {
    return false;
  }
  if (activeRun.session) {
    await activeRun.session.abort().catch(() => undefined);
  }
  await activeRun.client.stop().catch(() => undefined);
  return true;
}

async function appendSessionEvent(job: RunnerJob, event: SessionEvent, append: (line: string) => Promise<void>): Promise<void> {
  switch (event.type) {
    case "assistant.message":
      await append(`Assistant: ${trimForLog(event.data.content)}`);
      break;
    case "assistant.message_delta":
      if (event.data.deltaContent.trim()) {
        await append(`Assistant streaming: ${trimForLog(event.data.deltaContent)}`);
      }
      break;
    case "tool.execution_start":
      await append(`Tool started: ${event.data.toolName}`);
      break;
    case "tool.execution_complete":
      await append(`Tool completed: ${event.data.toolCallId} (${event.data.success ? "success" : "failed"})`);
      break;
    case "session.error":
      await append(`Session error: ${event.data.message}`);
      break;
    case "session.idle":
      await append(`Session idle for job ${job.id}.`);
      break;
    case "session.mcp_servers_loaded":
      await append(`MCP servers loaded: ${event.data.servers.map((server) => `${server.name}:${server.status}${server.error ? ` (${server.error})` : ""}`).join(", ")}`);
      break;
    case "session.mcp_server_status_changed":
      await append(`MCP server status: ${event.data.serverName}:${event.data.status}${event.data.error ? ` (${event.data.error})` : ""}`);
      break;
  }
}

function describePermissionRequest(request: PermissionRequest): string {
  switch (request.kind) {
    case "shell":
      return request.fullCommandText;
    case "write":
      return `write ${toRepoRelativePath(request.fileName)}`;
    case "read":
      return `read ${toRepoRelativePath(request.path)}`;
    case "mcp":
      return `mcp ${request.serverName}/${request.toolName}`;
    case "url":
      return request.url;
    case "memory":
      return `memory ${request.action ?? "operation"}`;
    default:
      return request.kind;
  }
}

function trimForLog(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

export function getPermissionPreview(): { allowedCommands: string[]; allowedWrites: string[] } {
  return {
    allowedCommands: [
      "mvn compile",
      "mvn test",
      "npx playwright install"
    ],
    allowedWrites: [
      "src/main/java/com/oracle/oic/pages",
      "src/main/java/com/oracle/oic/base",
      "src/main/java/com/oracle/oic/utils",
      "src/test/java/com/oracle/oic/tests",
      "src/test/java/com/oracle/oic/base",
      "src/test/resources/testdata",
      ".github/oic-knowledge.md",
      ".github/test-failure-log.md",
      "apps/oic-copilot-runner/data"
    ]
  };
}

export function evaluatePermissionPreview(): { commandPolicyReady: boolean; writePolicyReady: boolean } {
  return {
    commandPolicyReady: canRunCommand("mvn -q -DskipTests compile") && !canRunCommand("git push --force"),
    writePolicyReady: canWriteFile("src/test/java/com/oracle/oic/tests/SampleTests.java") && !canWriteFile("README.md")
  };
}
