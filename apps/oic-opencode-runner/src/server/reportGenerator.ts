import fs from "node:fs/promises";
import path from "node:path";
import type { RunnerArtifact, RunnerJob } from "../shared/types.js";
import { paths } from "./config.js";

const statusColors: Record<string, string> = {
  passed: "#1a7f37",
  generated: "#1a7f37",
  validated: "#1a7f37",
  running: "#9a6700",
  queued: "#9a6700",
  blocked: "#9a6700",
  failed: "#cf222e",
  ready: "#57606a"
};

export async function writeJobReport(job: RunnerJob): Promise<RunnerArtifact> {
  await fs.mkdir(paths.reportsPath, { recursive: true });
  const filePath = path.join(paths.reportsPath, `${job.id}.html`);
  await fs.writeFile(filePath, renderReport(job), "utf8");
  return { label: "Extent report", path: filePath, kind: "report" };
}

function renderReport(job: RunnerJob): string {
  const durationMs = new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime();
  const duration = formatDuration(durationMs);
  const toolCounts = countTools(job.log);
  const browserActions = Object.entries(toolCounts)
    .filter(([name]) => name.includes("browser_"))
    .reduce((total, [, count]) => total + count, 0);
  const finalResponse = job.log.find((line) => line.startsWith("Final assistant response:"))?.replace(/^Final assistant response:\s*/, "") ?? "";
  const badgeColor = statusColors[job.status] ?? "#57606a";

  const stepsHtml = (job.testCase.steps.length > 0 ? job.testCase.steps : [job.testCase.title])
    .map((step, index) => `<li><span class="stepNo">${index + 1}</span>${escapeHtml(step)}</li>`)
    .join("");

  const toolRows = Object.entries(toolCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${count}</td></tr>`)
    .join("");

  const timelineHtml = job.log
    .map((line) => renderLogLine(line))
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OIC Runner Report — ${escapeHtml(job.testCase.id)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f6f8fa; color: #1f2328; }
  header { background: linear-gradient(120deg,#0b3b6f,#1a7f7a); color: #fff; padding: 28px 32px; }
  header .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .72rem; opacity: .85; margin: 0 0 6px; }
  header h1 { margin: 0; font-size: 1.35rem; }
  header .title { margin: 8px 0 0; font-weight: 400; opacity: .95; max-width: 900px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; color: #fff; font-weight: 700; font-size: .8rem; background: ${badgeColor}; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 32px 60px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 14px; margin: 20px 0; }
  .metric { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: 14px 16px; }
  .metric span { display: block; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: #57606a; }
  .metric strong { font-size: 1.2rem; }
  section.card { background: #fff; border: 1px solid #d0d7de; border-radius: 12px; padding: 18px 22px; margin: 18px 0; }
  h2 { font-size: 1rem; margin: 0 0 12px; }
  ol.steps { margin: 0; padding: 0; list-style: none; }
  ol.steps li { padding: 8px 0; border-bottom: 1px dashed #e1e4e8; display: flex; gap: 10px; }
  ol.steps li:last-child { border-bottom: none; }
  .stepNo { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 50%; background: #0b3b6f; color: #fff; font-size: .75rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 8px; border-bottom: 1px solid #eaeef2; font-size: .88rem; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .timeline { font-family: "Cascadia Code", Consolas, monospace; font-size: .82rem; }
  .row { padding: 5px 10px; border-left: 3px solid #d0d7de; margin: 2px 0; background: #fbfcfd; }
  .row.assistant { border-left-color: #1a7f7a; }
  .row.tool { border-left-color: #0b3b6f; }
  .row.fail { border-left-color: #cf222e; background: #fff5f5; }
  .row.phase { border-left-color: #9a6700; background: #fffaf0; font-weight: 600; }
  pre.final { white-space: pre-wrap; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px; padding: 14px; font-size: .88rem; }
  footer { color: #57606a; font-size: .78rem; text-align: center; padding: 20px; }
</style>
</head>
<body>
<header>
  <p class="eyebrow">OIC OpenCode Runner — Extent Report</p>
  <h1>${escapeHtml(job.testCase.id)} &nbsp; <span class="badge">${escapeHtml(job.status.toUpperCase())}</span></h1>
  <p class="title">${escapeHtml(job.testCase.title)}</p>
</header>
<div class="wrap">
  <div class="metrics">
    <div class="metric"><span>Status</span><strong>${escapeHtml(job.status)}</strong></div>
    <div class="metric"><span>Duration</span><strong>${duration}</strong></div>
    <div class="metric"><span>Browser actions</span><strong>${browserActions}</strong></div>
    <div class="metric"><span>Feature</span><strong>${escapeHtml(job.testCase.feature)}</strong></div>
    <div class="metric"><span>Source row</span><strong>${escapeHtml(job.testCase.sheetName)} / ${job.testCase.rowNumber}</strong></div>
  </div>

  <section class="card">
    <h2>Excel steps</h2>
    <ol class="steps">${stepsHtml}</ol>
    ${job.testCase.expectedResult ? `<p><strong>Expected:</strong> ${escapeHtml(job.testCase.expectedResult)}</p>` : ""}
  </section>

  ${finalResponse ? `<section class="card"><h2>Final summary</h2><pre class="final">${escapeHtml(finalResponse)}</pre></section>` : ""}

  <section class="card">
    <h2>Tool usage</h2>
    <table><tbody>${toolRows || "<tr><td>No tools recorded</td><td class=\"num\">0</td></tr>"}</tbody></table>
  </section>

  <section class="card">
    <h2>Run timeline</h2>
    <div class="timeline">${timelineHtml}</div>
  </section>
</div>
<footer>Generated ${escapeHtml(new Date().toISOString())} — job ${escapeHtml(job.id)}</footer>
</body>
</html>`;
}

function renderLogLine(line: string): string {
  let cls = "row";
  if (/^Assistant/.test(line)) cls += " assistant";
  else if (/failed|Tool failed|error/i.test(line)) cls += " fail";
  else if (/^Tool /.test(line) || /MCP/.test(line)) cls += " tool";
  else if (/phase|Signing in|Signed in|generation|healer/i.test(line)) cls += " phase";
  return `<div class="${cls}">${escapeHtml(line)}</div>`;
}

function countTools(log: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of log) {
    const match = line.match(/^Tool started:\s*(.+)$/);
    if (match) {
      const name = match[1].trim();
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
