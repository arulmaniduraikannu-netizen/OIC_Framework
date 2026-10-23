import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import test from "node:test";
import { buildExcelMcpAvailableTools, buildExcelMcpServerConfig, canRecoverExcelMcpResponseAfterWaitFailure, getExcelMcpToolDenialReason, isMcpCompletionRecoverable, stageExcelFallbackInputs } from "./excelMcpFallback.js";
import { EXCEL_NATIVE_TOOL_SEARCH_CONFIG } from "./excelSessionTelemetry.js";
import type { ExcelSessionTelemetry } from "../shared/types.js";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

test("loads the pinned workspace Excel MCP entry into the isolated staging directory", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const server = buildExcelMcpServerConfig({
    servers: {
      "excel-mcp": {
        command: "uvx",
        args: ["--from", "git+https://github.com/mbeps/excel-mcp.git@3439a8540c50cd9620e2c3d538fcb799ed88b72d", "excel-mcp"],
        tools: ["*"]
      }
    }
  }, stagingDirectory);

  assert.deepEqual(server, {
    command: "uvx",
    args: ["--from", "git+https://github.com/mbeps/excel-mcp.git@3439a8540c50cd9620e2c3d538fcb799ed88b72d", "excel-mcp"],
    type: "stdio",
    tools: ["*"],
    workingDirectory: stagingDirectory
  });
});

test("rejects unpinned or remote Excel MCP workspace entries", () => {
  assert.throws(() => buildExcelMcpServerConfig({ servers: { "excel-mcp": { command: "uvx", args: ["excel-mcp"] } } }, "."), /reviewed pinned commit/);
  assert.throws(() => buildExcelMcpServerConfig({ servers: { "excel-mcp": { type: "http", url: "http://127.0.0.1/mcp" } } }, "."), /local uvx command/);
});

test("initializes MCP discovery and denies tools outside the staged Excel policy", () => {
  const tools = buildExcelMcpAvailableTools().toArray();

  assert.deepEqual(tools, ["mcp:*"]);
  assert.equal(getExcelMcpToolDenialReason("other-mcp-write_cells", { file_path: "events.csv" }, "."), "The Excel fallback session may call only configured Excel MCP tools; shell, Python, and custom-code execution are denied.");
});

test("stages CSV and ZIP members under generated safe filenames", async () => {
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-mcp-stage-test-"));
  const zip = new JSZip();
  zip.file("../escaped.csv", "Id,Amount\nA,10");
  zip.file("nested/second.csv", "Id,Amount\nB,20");

  try {
    const staged = await stageExcelFallbackInputs([
      { fileName: "first.csv", contentBase64: encode("Id,Amount\nC,30") },
      { fileName: "input.zip", contentBase64: Buffer.from(await zip.generateAsync({ type: "uint8array" })).toString("base64") }
    ], stagingDirectory);

    assert.equal(staged.length, 3);
    for (const file of staged) {
      assert.equal(path.dirname(file.absolutePath), stagingDirectory);
      assert.match(file.relativePath, /^\d{3}-/);
      assert.equal(await fs.stat(file.absolutePath).then((stat) => stat.isFile()), true);
    }
    assert.deepEqual((await fs.readdir(stagingDirectory)).sort(), staged.map((file) => path.basename(file.absolutePath)).sort());
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
});

test("allows read-only MCP calls only for staged paths", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "events.csv");
  const outsidePath = path.resolve(stagingDirectory, "..", "private.csv");

  assert.equal(getExcelMcpToolDenialReason("read_cells", { file_path: stagedPath }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp_read_cells", { file_path: stagedPath }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp_read_cells", JSON.stringify({ file_path: stagedPath }), stagingDirectory), undefined);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_read_cells", { file_path: outsidePath }, stagingDirectory) ?? "", /staged for this request/);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_read_cells", JSON.stringify({ file_path: outsidePath }), stagingDirectory) ?? "", /staged for this request/);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_read_cells", "not-json", stagingDirectory) ?? "", /valid JSON/);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_read_cells", "[]", stagingDirectory) ?? "", /must be an object/);
  assert.match(getExcelMcpToolDenialReason("other-server_write_cells", { file_path: stagedPath }, stagingDirectory) ?? "", /configured Excel MCP tools/);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_execute_python", { file_path: stagedPath }, stagingDirectory) ?? "", /custom-code execution/);
});

test("allows staged write and export paths while rejecting paths outside staging", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "events.csv");

  assert.equal(getExcelMcpToolDenialReason("excel-mcp-write_cells", {
    file_path: stagedPath,
    range: "A1:B2",
    values: [["Id", "Amount"]]
  }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp-export_workbook", {
    file_path: stagedPath,
    output_path: path.join(stagingDirectory, "comparison.xlsx")
  }, stagingDirectory), undefined);
  const denial = getExcelMcpToolDenialReason("excel-mcp-export_workbook", {
    file_path: stagedPath,
    output_path: path.resolve(stagingDirectory, "..", "comparison.xlsx")
  }, stagingDirectory);
  assert.match(denial ?? "", /staged for this request/);
});

test("distinguishes input xlsx_path from staged conversion output", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "events.xlsx");

  assert.equal(getExcelMcpToolDenialReason("excel-mcp-read_workbook", {
    xlsx_path: stagedPath
  }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp-csv_ops", {
    action: "to_xlsx",
    file_path: path.join(stagingDirectory, "events.csv"),
    xlsx_path: path.join(stagingDirectory, "events.xlsx")
  }, stagingDirectory), undefined);
  assert.match(getExcelMcpToolDenialReason("excel-mcp-csv_ops", {
    action: "to_xlsx",
    file_path: path.join(stagingDirectory, "events.csv"),
    xlsx_path: path.resolve(stagingDirectory, "..", "events.xlsx")
  }, stagingDirectory) ?? "", /staged for this request/);
});

test("allows CSV conversions only within staging", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "orders.csv");

  assert.equal(getExcelMcpToolDenialReason("excel-mcp-csv_ops", { action: "preview", file_path: stagedPath, rows: 10 }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp-csv_ops", { action: "aggregate", file_path: stagedPath, column: "Amount" }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp-csv_ops", { action: "to_xlsx", file_path: stagedPath, xlsx_path: path.join(stagingDirectory, "orders.xlsx") }, stagingDirectory), undefined);
  assert.equal(getExcelMcpToolDenialReason("excel-mcp-csv_ops", { action: "to_csv", file_path: path.join(stagingDirectory, "orders.xlsx"), output_path: path.join(stagingDirectory, "orders-copy.csv") }, stagingDirectory), undefined);
  assert.match(getExcelMcpToolDenialReason("excel-mcp-csv_ops", { action: "preview", file_path: path.resolve(stagingDirectory, "..", "private.csv") }, stagingDirectory) ?? "", /staged for this request/);
});

test("requires paths for staged Excel MCP calls", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const denial = getExcelMcpToolDenialReason("excel-mcp-create_workbook", {
    sheet_name: "Summary"
  }, stagingDirectory);

  assert.match(denial ?? "", /input or output path/);
});

test("does not treat an output path as an unrestricted filesystem escape", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "events.csv");
  const denial = getExcelMcpToolDenialReason("excel-mcp_multi_file", {
    action: "compare",
    file_a: stagedPath,
    file_b: stagedPath,
    output_file: path.resolve(stagingDirectory, "..", "comparison.xlsx")
  }, stagingDirectory);

  assert.match(denial ?? "", /staged for this request/);
});

test("guards singular, plural, camel-case, and nested MCP file path arguments", () => {
  const stagingDirectory = path.resolve("C:/runner-temp/excel-mcp-123");
  const stagedPath = path.join(stagingDirectory, "events.xlsx");
  const outsidePath = path.resolve(stagingDirectory, "..", "private.xlsx");

  assert.equal(getExcelMcpToolDenialReason("excel-mcp_worksheet_transfer", {
    source_file: stagedPath,
    dest_file: path.join(stagingDirectory, "combined.xlsx")
  }, stagingDirectory), undefined);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_worksheet_transfer", {
    source_files: [stagedPath, outsidePath],
    destination_path: path.join(stagingDirectory, "combined.xlsx")
  }, stagingDirectory) ?? "", /staged for this request/);
  assert.match(getExcelMcpToolDenialReason("excel-mcp_write_multi_sheet", {
    sourceFiles: [{ path: outsidePath }],
    outputFile: path.join(stagingDirectory, "combined.xlsx")
  }, stagingDirectory) ?? "", /staged for this request/);
});

test("fallback keeps wildcard MCP tools and native search without overriding the SDK threshold", () => {
  assert.deepEqual(buildExcelMcpAvailableTools().toArray(), ["mcp:*"]);
  assert.deepEqual(EXCEL_NATIVE_TOOL_SEARCH_CONFIG, { enabled: true });
  assert.equal("deferThreshold" in EXCEL_NATIVE_TOOL_SEARCH_CONFIG, false);
});

test("accepts successful MCP evidence when the session never reaches idle", () => {
  assert.equal(isMcpCompletionRecoverable("The sum is 58,574,069.11 across 13,846 rows.", 1), true);
  assert.equal(isMcpCompletionRecoverable('{"count":13846,"sum_val":58574069.108724795}', 1), true);
});

test("does not accept missing-idle completion without successful MCP evidence", () => {
  assert.equal(isMcpCompletionRecoverable("The sum is 58,574,069.11 across 13,846 rows.", 0), false);
  assert.equal(isMcpCompletionRecoverable("I could not complete the request.", 1), false);
});

test("fallback preserves successful MCP evidence only after an idle timeout", () => {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "fallback-timeout", turns: 1, turnIds: [], toolCalls: 1, idle: false,
    errors: [], taskComplete: false, eventTypes: []
  };
  const answer = "The sum is 58,574,069.11 across 13,846 rows.";

  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure(answer, 1, "idleTimeout", telemetry), true);
  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure(answer, 1, "sdkError", telemetry), false);
  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure(answer, 0, "idleTimeout", telemetry), false);
});

test("fallback rejects timeout recovery when session error or cancellation was observed", () => {
  const base: ExcelSessionTelemetry = {
    sessionId: "fallback-invalid-lifecycle", turns: 1, turnIds: [], toolCalls: 1, idle: false,
    errors: [], taskComplete: false, eventTypes: []
  };
  const answer = "The requested total is 58,574,069.11.";

  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure(answer, 1, "sessionError", { ...base, errors: ["transport failed"] }), false);
  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure(answer, 1, "aborted", { ...base, idle: true, idleAborted: true }), false);
});

test("budget denials remain distinct and cannot substitute for successful MCP evidence", () => {
  const telemetry: ExcelSessionTelemetry = {
    sessionId: "fallback-budget-denial", turns: 1, turnIds: [], toolCalls: 1, idle: false,
    errors: [], toolFailures: ["MCP_EXECUTION_BUDGET_EXHAUSTED"], taskComplete: false, eventTypes: [],
    mcpBudget: {
      limits: { maxCalls: 1, maxRecoveries: 0, maxConsecutiveFailures: 1, maxDurationMs: 1 },
      calls: 0, recoveries: 0, successes: 0, failures: 0, consecutiveFailures: 0, elapsedMs: 0, deadlineAborted: false,
      exhaustedCode: "maxToolCalls", exhaustedReason: "call limit reached"
    }
  };

  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure("No completed result", 0, "idleTimeout", telemetry), false);
  assert.equal(canRecoverExcelMcpResponseAfterWaitFailure("No completed result", 1, "aborted", telemetry), false);
});

