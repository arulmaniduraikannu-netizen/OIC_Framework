import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";

export interface ExcelCopilotRunOptions {
  runId?: string;
  autonomous?: boolean;
  maxCompletionNudges?: number;
  captureMcpToolDiscovery?: boolean;
}

interface ActiveExcelCopilotRun {
  client: CopilotClient;
  session?: CopilotSession;
}

const activeRuns = new Map<string, ActiveExcelCopilotRun>();

export function registerExcelCopilotClient(runId: string, client: CopilotClient): void {
  activeRuns.set(runId, { client });
}

export function registerExcelCopilotSession(runId: string, session: CopilotSession): void {
  const activeRun = activeRuns.get(runId);
  if (activeRun) {
    activeRun.session = session;
  }
}

export function unregisterExcelCopilotRun(runId: string): void {
  activeRuns.delete(runId);
}

export async function cancelExcelCopilotRun(runId: string): Promise<boolean> {
  const activeRun = activeRuns.get(runId);
  if (!activeRun) {
    return false;
  }
  await activeRun.session?.disconnect().catch(() => undefined);
  await activeRun.client.stop().catch(() => undefined);
  activeRuns.delete(runId);
  return true;
}