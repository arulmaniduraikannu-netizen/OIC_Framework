export interface ExcelMcpExecutionBudgetLimits {
  maxCalls: number;
  maxRecoveries: number;
  maxConsecutiveFailures: number;
  maxDurationMs: number;
}

export interface ExcelMcpExecutionBudgetSnapshot {
  limits: ExcelMcpExecutionBudgetLimits;
  calls: number;
  recoveries: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  elapsedMs: number;
  deadlineAborted: boolean;
  exhaustedCode?: ExcelMcpBudgetExhaustionCode;
  exhaustedReason?: string;
}

export type ExcelMcpBudgetExhaustionCode = "maxToolCalls" | "maxRecoveries" | "maxConsecutiveFailures" | "maxDuration";

export interface ExcelMcpBudgetDenial {
  code: ExcelMcpBudgetExhaustionCode;
  reason: string;
}

interface BudgetClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const DEFAULT_LIMITS: ExcelMcpExecutionBudgetLimits = {
  maxCalls: 24,
  maxRecoveries: 2,
  maxConsecutiveFailures: 3,
  maxDurationMs: 300_000
};
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const systemClock: BudgetClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer)
};

function readLimit(value: string | undefined, fallback: number, allowZero = false): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) return fallback;
  return parsed;
}

export function getExcelMcpExecutionBudgetLimits(environment: NodeJS.ProcessEnv = process.env): ExcelMcpExecutionBudgetLimits {
  return {
    maxCalls: readLimit(environment.OIC_RUNNER_MCP_MAX_CALLS, DEFAULT_LIMITS.maxCalls),
    maxRecoveries: readLimit(environment.OIC_RUNNER_MCP_MAX_RECOVERIES, DEFAULT_LIMITS.maxRecoveries, true),
    maxConsecutiveFailures: readLimit(environment.OIC_RUNNER_MCP_MAX_CONSECUTIVE_FAILURES, DEFAULT_LIMITS.maxConsecutiveFailures),
    maxDurationMs: Math.min(readLimit(environment.OIC_RUNNER_MCP_MAX_DURATION_MS, DEFAULT_LIMITS.maxDurationMs), MAX_TIMER_DELAY_MS)
  };
}

export class ExcelMcpExecutionBudget {
  private readonly activeCalls = new Map<string, number>();
  private startedAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private onHardDeadlineAbort?: (reason: string) => void;
  private calls = 0;
  private recoveries = 0;
  private successes = 0;
  private failures = 0;
  private consecutiveFailures = 0;
  private deadlineAborted = false;
  private exhaustedCode?: ExcelMcpBudgetExhaustionCode;
  private exhaustedReason?: string;

  constructor(
    private readonly limits: ExcelMcpExecutionBudgetLimits = getExcelMcpExecutionBudgetLimits(),
    private readonly clock: BudgetClock = systemClock
  ) {}

  admit(onHardDeadlineAbort: (reason: string) => void): ExcelMcpBudgetDenial | undefined {
    this.onHardDeadlineAbort = onHardDeadlineAbort;
    this.checkElapsedDeadline();
    if (this.exhaustedCode) return this.denial();
    if (this.calls >= this.limits.maxCalls) {
      this.exhaust("maxToolCalls", `Excel MCP call budget exhausted (${this.limits.maxCalls} calls).`);
      return this.denial();
    }
    if (this.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
      this.exhaust("maxConsecutiveFailures", `Excel MCP consecutive failure budget exhausted (${this.limits.maxConsecutiveFailures} failures).`);
      return this.denial();
    }
    if (this.consecutiveFailures > 0 && this.recoveries >= this.limits.maxRecoveries) {
      this.exhaust("maxRecoveries", `Excel MCP recovery budget exhausted (${this.limits.maxRecoveries} recovery calls).`);
      return this.denial();
    }

    if (this.startedAt === undefined) {
      this.startedAt = this.clock.now();
      this.timer = this.clock.setTimeout(() => {
        this.exhaust("maxDuration", `Excel MCP time budget exhausted (${this.limits.maxDurationMs} ms).`);
        this.abortInFlightForDeadline();
      }, this.limits.maxDurationMs);
      this.timer.unref?.();
    }
    this.calls += 1;
    if (this.consecutiveFailures > 0) this.recoveries += 1;
    return undefined;
  }

  recordStart(toolCallId: string): void {
    if (this.startedAt !== undefined) {
      this.activeCalls.set(toolCallId, this.clock.now());
      this.checkElapsedDeadline();
    }
  }

  recordCompletion(toolCallId: string, success: boolean): void {
    if (!this.activeCalls.has(toolCallId)) return;
    this.activeCalls.delete(toolCallId);

    if (success) {
      this.successes += 1;
      this.consecutiveFailures = 0;
      return;
    }

    this.failures += 1;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
      this.exhaust("maxConsecutiveFailures", `Excel MCP consecutive failure budget exhausted (${this.limits.maxConsecutiveFailures} failures).`);
    }
  }

  getSnapshot(): ExcelMcpExecutionBudgetSnapshot {
    return {
      limits: { ...this.limits },
      calls: this.calls,
      recoveries: this.recoveries,
      successes: this.successes,
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      elapsedMs: this.startedAt === undefined ? 0 : Math.max(0, this.clock.now() - this.startedAt),
      deadlineAborted: this.deadlineAborted,
      ...(this.exhaustedCode ? { exhaustedCode: this.exhaustedCode } : {}),
      ...(this.exhaustedReason ? { exhaustedReason: this.exhaustedReason } : {})
    };
  }

  stop(): void {
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private checkElapsedDeadline(): void {
    if (this.startedAt === undefined) return;
    if (this.exhaustedCode === "maxDuration") {
      this.abortInFlightForDeadline();
      return;
    }
    if (this.exhaustedCode || this.clock.now() - this.startedAt < this.limits.maxDurationMs) return;
    this.exhaust("maxDuration", `Excel MCP time budget exhausted (${this.limits.maxDurationMs} ms).`);
    this.abortInFlightForDeadline();
  }

  private abortInFlightForDeadline(): void {
    if (!this.activeCalls.size || this.deadlineAborted || !this.exhaustedReason) return;
    this.deadlineAborted = true;
    this.onHardDeadlineAbort?.(this.exhaustedReason);
  }

  private denial(): ExcelMcpBudgetDenial {
    return { code: this.exhaustedCode!, reason: this.exhaustedReason! };
  }

  private exhaust(code: ExcelMcpBudgetExhaustionCode, reason: string): void {
    if (!this.exhaustedReason) {
      this.exhaustedCode = code;
      this.exhaustedReason = reason;
    }
  }
}

export function isExcelMcpToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized.startsWith("mcp__excel-mcp__")
    || normalized.startsWith("excel-mcp_")
    || normalized.startsWith("excel-mcp-")
    || normalized.startsWith("excel-mcp/");
}