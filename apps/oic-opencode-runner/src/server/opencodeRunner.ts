import fs from "node:fs/promises";
import path from "node:path";
import { createOpencode } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { NormalizedTestCase, RunProfile, RunnerJob } from "../shared/types.js";
import { closeOicBrowserPreflight, loginOic } from "./browserPreflight.js";
import { paths, settings } from "./config.js";
import { canRunCommand, canWriteFile, toRepoRelativePath } from "./permissionPolicy.js";
import { writeJobReport } from "./reportGenerator.js";
import { runExistingTest } from "./testExecutor.js";
import { findExistingTestCase, type ExistingTestCaseMatch } from "./testDiscovery.js";

type JobUpdateHandler = (job: RunnerJob) => Promise<void>;

const activeOpenCodeRuns = new Map<string, { abort: () => void }>();
const cancelledJobIds = new Set<string>();

export async function buildGenerationPrompt(testCase: NormalizedTestCase): Promise<string> {
  const steps = testCase.steps && testCase.steps.length > 0 ? testCase.steps : [testCase.title];

  return [
    "Run the Oracle OIC test generation workflow for this Excel-sourced test case.",
    "Preserve the existing workspace rules. Do not guess locators or workflows.",
    "You have the full Playwright MCP browser toolset connected to a visible, signed-in Chrome. Drive the live Oracle Fusion portal end to end exactly like an interactive agent would.",
    "Use the Playwright MCP tools to perform every step: browser_navigate, browser_snapshot, browser_click, browser_type, browser_fill_form, browser_select_option, browser_file_upload, browser_press_key, and browser_wait_for.",
    "Before reading or editing test files, navigate to the Oracle Fusion FSM welcome page and snapshot. If an Oracle sign-in / account picker appears, click the signed-in account tile to continue; only stop if a password or MFA is genuinely required.",
    "Actually execute each Excel step in the portal (navigate, click, fill, upload, submit) and capture a snapshot after each meaningful action as evidence.",
    "As you drive the portal, capture the real verified locators and workflow, then generate the Oracle OIC Java/TestNG Playwright test files (page object + test), externalize any environment data, run the repository validation command, and run a focused Maven build/test when possible.",
    "Do not commit, push, rebase, force-push, delete unrelated files, or use package install/update commands.",
    "If Oracle Fusion authentication, tenant access, or live portal state blocks progress, stop and report the exact blocker in the final response.",
    "",
    "## Exact steps to perform (from the Excel test case)",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Test case from Excel",
    JSON.stringify(testCase, null, 2)
  ].join("\n");
}

export async function buildLiveDriveFallbackPrompt(testCase: NormalizedTestCase, match: ExistingTestCaseMatch, testOutput: string): Promise<string> {
  const generation = await buildGenerationPrompt(testCase);
  return [
    "A compiled Oracle OIC Java/TestNG Playwright test already exists for this Excel test case but it FAILED at one step during the Maven test run (output below).",
    "Do NOT just change one locator and re-run the compiled test. Instead, COMPLETE THE ENTIRE SCENARIO LIVE IN A SINGLE BROWSER SESSION now, then update the existing test at the end.",
    "Hard rules for this one-browser fallback run:",
    "  - Drive the whole scenario end-to-end in ONE Playwright MCP browser, from the first Excel step to the last, in order, using the exact values from each step.",
    "  - COVER EVERY EXCEL STEP — NO SHORTCUTS. Walk each step explicitly and take a snapshot at each, even if a later step's goal already looks satisfied on the current screen.",
    "  - When a step's locator does not match, you are ALREADY on that page — take a snapshot, find the real element, act on it, and CONTINUE to the next step in the SAME browser. Never restart the browser.",
    "  - POINTER INTERCEPTION (ADF / Oracle Fusion): if a browser_click on a checkbox/toggle fails or times out with 'subtree intercepts pointer events', click the associated LABEL, the selection ROW, or the semantic role element by accessible name instead.",
    "  - DURABLE LOCATORS ONLY — what passes LIVE must also pass a COLD compiled run. Before you write ANY locator into the test, you MUST re-perform that same action in the live browser using the exact durable Playwright locator you intend to write and confirm it acts on the right element.",
    "  - Add explicit web-first waits for slow portal surfaces: before acting inside an ADF page/iframe, expect the frame element or first field to be visible with a 60s timeout.",
    "  - Finish the run in this single browser pass so the whole test case is exercised live to completion.",
    "  - Then UPDATE THE EXISTING test files identified below (do NOT create a duplicate) so EVERY step you walked is written back with its snapshot-verified locator.",
    "  - Only stop early if the Maven output below shows a genuine auth/ENV redirect (login page / Oracle sign-in / session expiry). Otherwise you MUST complete the scenario and fix the test.",
    "  - Your edits will be VERIFIED: after you finish, the runner re-runs the compiled Maven test. If any step still fails, you will be called again with that exact failure.",
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

  const runProfile = getRunProfile(current);
  if (password && runProfile.username) {
    current = await updateJob(current, onUpdate, {
      phase: "Signing in to Oracle Fusion",
      log: [`Signing in as ${runProfile.username} before running...`]
    });
    try {
      const result = await loginOic(runProfile.username, password);
      current = await updateJob(current, onUpdate, { log: [result.message] });
    } catch (error) {
      current = await updateJob(current, onUpdate, {
        log: [`Sign-in step reported: ${error instanceof Error ? error.message : String(error)}. Continuing — complete any MFA in the browser window if it appears.`]
      });
    }
  }

  return runOpenCodeJob(current, onUpdate);
}

export async function runOpenCodeJob(job: RunnerJob, onUpdate: JobUpdateHandler): Promise<RunnerJob> {
  const prompt = [
    await buildGenerationPrompt(job.testCase),
    "",
    "## Run profile from app UI",
    JSON.stringify(getRunProfile(job), null, 2)
  ].join("\n");

  return runOpenCodePrompt(job, onUpdate, prompt, {
    startPhase: "Starting OpenCode session",
    preparedPhase: "OpenCode generation prompt prepared",
    sessionPhase: "OpenCode session running",
    completedPhase: "OpenCode run finished",
    completedStatus: "generated",
    startLog: "Creating an OpenCode server session with the Playwright MCP browser."
  });
}

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
  if (password && runProfile.username) {
    current = await updateJob(current, onUpdate, {
      phase: "Signing in to Oracle Fusion",
      log: [`Signing in as ${runProfile.username} to authenticate the test browser...`]
    });
    try {
      const result = await loginOic(runProfile.username, password);
      if (result.storageStatePath) {
        runProfile.storageStatePath = result.storageStatePath;
      }
      current = await updateJob(current, onUpdate, { log: [result.message] });
    } catch (error) {
      current = await updateJob(current, onUpdate, {
        log: [`Sign-in step reported: ${error instanceof Error ? error.message : String(error)}. Continuing with any saved storage state.`]
      });
    }
    await closeOicBrowserPreflight();
  }

  current = await updateJob(current, onUpdate, {
    phase: "Running existing compiled test",
    log: [`Found ${match.relativePath} — ${match.fullyQualifiedName}. Running via mvn test...`]
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

  const authFailure = /signin|login\.us2\.oraclecloud\.com|session\s+expired|sign in to your account|AADSTS|correlation id/i.test(result.output);
  if (authFailure) {
    current = await updateJob(current, onUpdate, {
      status: "blocked",
      phase: "Existing test failed — auth/environment",
      log: ["The test stopped at the Oracle sign-in page (auth/ENV), not a locator issue. Sign in and retry — skipping live-drive so locators are not changed for a sign-in problem."]
    });
    return finalizeExistingTestJob(current, onUpdate);
  }

  const maxPasses = Number(process.env.OIC_MAX_LIVEDRIVE_PASSES) || 3;
  let failureOutput = result.output;

  for (let pass = 1; ; pass++) {
    current = await updateJob(current, onUpdate, {
      status: "running",
      phase: `Live-driving the full scenario in one browser (pass ${pass} of ${maxPasses})`,
      log: [pass === 1
        ? "Existing test failed at a step. Handing off to a single OpenCode + Playwright MCP browser: it runs the ENTIRE scenario live end-to-end, self-corrects inline, and updates the test with snapshot-verified locators."
        : `The compiled test still failed at a step. Live-driving again (pass ${pass}) to verify and fix that exact step from a fresh live snapshot.`]
    });

    const liveDrivePrompt = [
      await buildLiveDriveFallbackPrompt(job.testCase, match, failureOutput),
      "",
      "## Run profile from app UI",
      JSON.stringify(runProfile, null, 2)
    ].join("\n");

    current = await runOpenCodePrompt(current, onUpdate, liveDrivePrompt, {
      startPhase: `Starting live-drive fallback (pass ${pass})`,
      preparedPhase: "Live-drive prompt prepared",
      sessionPhase: "Live-driving the portal end-to-end in one browser and fixing the test",
      completedPhase: "Live-drive pass finished — verifying by re-running the test",
      completedStatus: "running",
      startLog: "Creating an OpenCode session to complete the whole scenario live in one browser."
    });

    current = await updateJob(current, onUpdate, {
      status: "running",
      phase: "Verifying the live-drive fix by re-running the compiled test",
      log: ["Live-drive pass finished. Re-running the compiled test to verify the code actually passes..."]
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

async function runOpenCodePrompt(
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

  let serverHandle: { url: string; close(): void } | undefined;
  let client: OpencodeClient | undefined;

  try {
    await closeOicBrowserPreflight();
    current = await updateJob(current, onUpdate, {
      phase: "Starting OpenCode server",
      log: ["Starting the OpenCode server process (opencode serve)..."]
    });

    const model = current.model || settings.model;

    const opencode = await createOpencode({
      port: 4096,
      config: {
        model: model
      }
    });
    serverHandle = opencode.server;
    client = opencode.client;

    current = await updateJob(current, onUpdate, {
      log: [`OpenCode server running at ${opencode.server.url}`]
    });

    const config = await client.config.get();
    current = await updateJob(current, onUpdate, {
      log: [`OpenCode config loaded: ${config.data?.model ?? "default model"}`]
    });

    current = await updateJob(current, onUpdate, {
      phase: labels.sessionPhase,
      log: ["Creating OpenCode session..."]
    });

    const sessionRes = await client.session.create({
      body: { title: `OIC test generation — ${current.testCase.id}` }
    });
    const sessionId = sessionRes.data?.id ?? "";
    const errorDetail = sessionRes.error ? JSON.stringify(sessionRes.error) : null;

    current = await updateJob(current, onUpdate, {
      log: [
        `Session created: ${sessionId || "(empty)"}`,
        errorDetail ? `Session create error: ${errorDetail}` : null
      ].filter(Boolean) as string[]
    });

    if (!sessionId) {
      throw new Error(`Failed to create OpenCode session. SDK response: ${JSON.stringify({ data: sessionRes.data, error: sessionRes.error, response: { status: sessionRes.response?.status } })}`);
    }

    activeOpenCodeRuns.set(job.id, {
      abort: () => {
        client?.session.abort({ path: { id: sessionId } }).catch(() => undefined);
      }
    });

    current = await updateJob(current, onUpdate, { log: ["Prompt sent to OpenCode generator."] });

    const sessionTimeoutMs = Number(process.env.OIC_RUNNER_SESSION_TIMEOUT_MS) || 120 * 60 * 1000;

    let sessionHadActivity = false;
    let finalContent = "";

    const eventsHandle = await client.event.subscribe();

    const eventConsumer = (async () => {
      try {
        for await (const event of eventsHandle.stream) {
          const eventType = (event as any)?.type ?? "unknown";
          const eventPayload = (event as any)?.payload ?? event;

          if (eventType === "permission.updated" || eventType === "permission.replied") {
            const permId = (eventPayload as any)?.properties?.id ?? "";
            const permType = (eventPayload as any)?.properties?.type ?? "";
            sessionHadActivity = true;
            current = await updateJob(current, onUpdate, {
              log: [`Permission request: ${permType} (${permId}) — auto-approving`]
            });
            if (permId && client) {
              await client.postSessionIdPermissionsPermissionId({
                path: { id: sessionId, permissionID: permId },
                body: { response: "always" }
              }).catch((err: unknown) => {
                console.error("Permission reply failed:", err);
              });
            }
          } else if (eventType === "message.updated" || eventType === "message.part.updated") {
            sessionHadActivity = true;
          } else if (eventType === "session.idle" || eventType === "session.compacted") {
            sessionHadActivity = true;
          }

          if (eventType !== "server.connected" && eventType !== "session.created" && eventType !== "session.updated") {
            current = await updateJob(current, onUpdate, { log: [`Event: ${eventType}`] });
          }
        }
      } catch {
        // stream ended or errored — expected when session ends
      }
    })();

    const resultPromise = client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: prompt }]
      }
    });

    const result = await Promise.race([
      resultPromise.then((res) => {
        const parts = res.data?.parts ?? [];
        const textParts = parts.filter((p: any) => p.type === "text");
        finalContent = textParts.map((p: any) => p.text ?? "").join("");
        sessionHadActivity = true;
        return { timedOut: false, content: finalContent, error: res.error };
      }),
      new Promise<{ timedOut: true; content: ""; error: unknown }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true, content: "", error: null }), sessionTimeoutMs)
      )
    ]);

    try { await eventConsumer; } catch { /* expected */ }

    await client.session.abort({ path: { id: sessionId } }).catch(() => undefined);

    if (result.error) {
      current = await updateJob(current, onUpdate, {
        status: "failed",
        phase: "OpenCode prompt failed",
        log: [`Prompt error: ${JSON.stringify(result.error)}`]
      });
    } else {
      const blocked = /\bblocked\b|does not expose the required|cannot complete|can't complete/i.test(result.content);
      const noActivity = !sessionHadActivity && !result.content.trim();

      current = await updateJob(current, onUpdate, {
        status: result.timedOut ? "failed" : noActivity ? "failed" : blocked ? "blocked" : labels.completedStatus,
        phase: result.timedOut
          ? "OpenCode run timed out"
          : noActivity
            ? "OpenCode run failed — no activity"
            : blocked
              ? "OpenCode run blocked"
              : labels.completedPhase,
        log: [result.timedOut
          ? `OpenCode session did not complete within ${sessionTimeoutMs / 1000 / 60} minutes.`
          : noActivity
            ? "OpenCode became idle without an assistant response or tool activity; the test case was not run."
            : result.content
              ? `Final assistant response: ${trimForLog(result.content)}`
              : "OpenCode run finished without a final assistant message."]
      });
    }
  } catch (error) {
    current = await updateJob(current, onUpdate, {
      status: "failed",
      phase: "OpenCode run failed",
      log: [error instanceof Error ? error.message : String(error)]
    });
  } finally {
    activeOpenCodeRuns.delete(job.id);
    if (serverHandle) {
      serverHandle.close();
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

async function updateJob(job: RunnerJob, onUpdate: JobUpdateHandler, patch: Partial<Pick<RunnerJob, "status" | "phase" | "log" | "artifacts">>): Promise<RunnerJob> {
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

export async function cancelOpenCodeJob(jobId: string): Promise<boolean> {
  const activeRun = activeOpenCodeRuns.get(jobId);
  cancelledJobIds.add(jobId);
  if (!activeRun) {
    return false;
  }
  activeRun.abort();
  return true;
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
      "apps/oic-opencode-runner/data"
    ]
  };
}

export function evaluatePermissionPreview(): { commandPolicyReady: boolean; writePolicyReady: boolean } {
  return {
    commandPolicyReady: canRunCommand("mvn -q -DskipTests compile") && !canRunCommand("git push --force"),
    writePolicyReady: canWriteFile("src/test/java/com/oracle/oic/tests/SampleTests.java") && !canWriteFile("README.md")
  };
}
