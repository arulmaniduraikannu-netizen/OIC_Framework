import assert from "node:assert/strict";
import test from "node:test";
import { ExcelMcpExecutionBudget, getExcelMcpExecutionBudgetLimits } from "./excelMcpExecutionBudget.js";

function createClock() {
  let currentTime = 100;
  let scheduled: (() => void) | undefined;
  let cleared = false;
  return {
    clock: {
      now: () => currentTime,
      setTimeout: (callback: () => void) => {
        scheduled = callback;
        return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => { cleared = true; }
    },
    advance: (milliseconds: number) => { currentTime += milliseconds; },
    expire: () => scheduled?.(),
    wasCleared: () => cleared
  };
}

test("loads bounded MCP defaults and accepts valid environment overrides", () => {
  assert.deepEqual(getExcelMcpExecutionBudgetLimits({} as NodeJS.ProcessEnv), {
    maxCalls: 24,
    maxRecoveries: 2,
    maxConsecutiveFailures: 3,
    maxDurationMs: 300_000
  });
  assert.deepEqual(getExcelMcpExecutionBudgetLimits({
    OIC_RUNNER_MCP_MAX_CALLS: "8",
    OIC_RUNNER_MCP_MAX_RECOVERIES: "0",
    OIC_RUNNER_MCP_MAX_CONSECUTIVE_FAILURES: "2",
    OIC_RUNNER_MCP_MAX_DURATION_MS: "15000"
  } as NodeJS.ProcessEnv), {
    maxCalls: 8,
    maxRecoveries: 0,
    maxConsecutiveFailures: 2,
    maxDurationMs: 15_000
  });
});

test("bounds MCP calls and permits only configured recovery calls after failures", () => {
  const budget = new ExcelMcpExecutionBudget({ maxCalls: 4, maxRecoveries: 1, maxConsecutiveFailures: 3, maxDurationMs: 60_000 });
  const abortReasons: string[] = [];

  assert.equal(budget.admit((reason) => abortReasons.push(reason)), undefined);
  budget.recordStart("call-1");
  budget.recordCompletion("call-1", false);
  assert.equal(budget.admit((reason) => abortReasons.push(reason)), undefined);
  budget.recordStart("call-2");
  budget.recordCompletion("call-2", false);

  assert.deepEqual(budget.admit((reason) => abortReasons.push(reason)), {
    code: "maxRecoveries",
    reason: "Excel MCP recovery budget exhausted (1 recovery calls)."
  });
  assert.deepEqual(budget.admit((reason) => abortReasons.push(reason)), {
    code: "maxRecoveries",
    reason: "Excel MCP recovery budget exhausted (1 recovery calls)."
  });
  assert.equal(budget.getSnapshot().calls, 2);
  assert.equal(budget.getSnapshot().recoveries, 1);
  assert.equal(abortReasons.length, 0);
  budget.stop();
});

test("resets consecutive failures after success and enforces the total call limit", () => {
  const budget = new ExcelMcpExecutionBudget({ maxCalls: 2, maxRecoveries: 2, maxConsecutiveFailures: 2, maxDurationMs: 60_000 });
  const onExhausted = () => undefined;

  assert.equal(budget.admit(onExhausted), undefined);
  budget.recordStart("call-1");
  budget.recordCompletion("call-1", false);
  assert.equal(budget.admit(onExhausted), undefined);
  budget.recordStart("call-2");
  budget.recordCompletion("call-2", true);
  assert.equal(budget.getSnapshot().consecutiveFailures, 0);
  assert.deepEqual(budget.admit(onExhausted), {
    code: "maxToolCalls",
    reason: "Excel MCP call budget exhausted (2 calls)."
  });
  assert.equal(budget.getSnapshot().successes, 1);
  assert.equal(budget.getSnapshot().failures, 1);
  budget.stop();
});

test("does not abort for consecutive-failure exhaustion when another admitted call succeeds", () => {
  const budget = new ExcelMcpExecutionBudget({ maxCalls: 4, maxRecoveries: 2, maxConsecutiveFailures: 1, maxDurationMs: 60_000 });
  const abortReasons: string[] = [];
  const onDeadlineAbort = (reason: string) => abortReasons.push(reason);

  assert.equal(budget.admit(onDeadlineAbort), undefined);
  assert.equal(budget.admit(onDeadlineAbort), undefined);
  budget.recordStart("call-1");
  budget.recordStart("call-2");
  budget.recordCompletion("call-1", false);
  budget.recordCompletion("call-2", true);

  assert.equal(budget.getSnapshot().exhaustedCode, "maxConsecutiveFailures");
  assert.equal(budget.getSnapshot().failures, 1);
  assert.equal(budget.getSnapshot().successes, 1);
  assert.equal(budget.getSnapshot().deadlineAborted, false);
  assert.equal(abortReasons.length, 0);
  budget.stop();
});

test("aborts only when the MCP deadline expires with an in-flight tool call", () => {
  const fake = createClock();
  const budget = new ExcelMcpExecutionBudget({ maxCalls: 4, maxRecoveries: 2, maxConsecutiveFailures: 3, maxDurationMs: 500 }, fake.clock);
  const abortReasons: string[] = [];

  assert.equal(budget.admit((reason) => abortReasons.push(reason)), undefined);
  budget.recordStart("call-1");
  fake.advance(500);
  fake.expire();

  assert.match(budget.getSnapshot().exhaustedReason ?? "", /time budget exhausted/);
  assert.equal(budget.getSnapshot().elapsedMs, 500);
  assert.equal(abortReasons.length, 1);
  assert.equal(budget.getSnapshot().deadlineAborted, true);
  budget.stop();
  assert.equal(fake.wasCleared(), true);
});

test("expired deadline denies the next MCP call without aborting an idle session", () => {
  const fake = createClock();
  const budget = new ExcelMcpExecutionBudget({ maxCalls: 4, maxRecoveries: 2, maxConsecutiveFailures: 3, maxDurationMs: 500 }, fake.clock);
  const abortReasons: string[] = [];

  assert.equal(budget.admit((reason) => abortReasons.push(reason)), undefined);
  fake.advance(500);
  fake.expire();

  assert.equal(budget.admit((reason) => abortReasons.push(reason))?.code, "maxDuration");
  assert.equal(abortReasons.length, 0);
  assert.equal(budget.getSnapshot().deadlineAborted, false);
  budget.stop();
});