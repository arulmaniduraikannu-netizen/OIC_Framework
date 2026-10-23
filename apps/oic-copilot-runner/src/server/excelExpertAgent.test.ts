import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import type { ExcelPromptPlan, ExcelPromptResponse } from "../shared/types.js";
import type { ExcelMcpFallbackResult } from "./excelMcpFallback.js";
import { resolveExcelArtifact } from "./excelArtifactStore.js";
import { getExcelCapabilityContracts } from "./excelCapabilities.js";
import { getExcelOperationCapabilities } from "./excelCapabilities.js";
import { createDefaultExcelOperationRegistry } from "./excelAnalysisRegistry.js";
import { planExcelPrompt, validateExecutionPlanShape } from "./excelPromptPlanner.js";
import { ExcelSessionWaitError } from "./excelSessionTelemetry.js";
import { autonomousRuntimeFailureResponse, discoverExcelFiles, runExcelAnalysis, runExcelPrompt } from "./excelExpertAgent.js";

const injectedPlanner = async (): Promise<ExcelPromptPlan> => ({ status: "unsupported", reason: "test planner" });

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

test("exposes the local and MCP capability contracts", () => {
  const capabilities = getExcelCapabilityContracts();

  assert.deepEqual(capabilities.map((capability) => capability.id), ["local-registry", "excel-mcp"]);
  assert.equal(capabilities[0].deterministic, true);
  assert.equal(capabilities[0].localVerification, "performed");
  assert.equal(capabilities[1].deterministic, false);
  assert.equal(capabilities[1].localVerification, "not-performed");
  assert.equal(capabilities.every((capability) => capability.readOnly), true);
  assert.deepEqual(capabilities[0].operationKinds, createDefaultExcelOperationRegistry().getOperationKinds());
});

test("operation capability catalog exactly follows registered deterministic operations plus XLSX export", () => {
  const registry = createDefaultExcelOperationRegistry();
  const catalog = getExcelOperationCapabilities(registry);
  assert.deepEqual(catalog.slice(0, -1).map((entry) => entry.id), registry.getOperationKinds());
  assert.equal(catalog.at(-1)?.id, "exportXlsx");
  assert.equal(catalog.at(-1)?.createsArtifact, true);
  assert.equal((catalog as Array<{ id: string }>).some((entry) => entry.id === "sort" || entry.id === "project"), false);
});

test("generic capability metadata contains no business-specific workbook assumptions", () => {
  const serialized = JSON.stringify(getExcelOperationCapabilities()).toLowerCase();
  for (const domainTerm of ["event date", "transaction number", "invoice number", "transaction workbook"]) {
    assert.equal(serialized.includes(domainTerm), false, `Capability catalog unexpectedly contains ${domainTerm}.`);
  }
  const lookup = getExcelOperationCapabilities().find((entry) => entry.id === "lookup");
  assert.deepEqual(lookup?.operators, ["equals", "contains"]);
  assert.match(lookup?.limitations.join(" ") ?? "", /10,000/);
});

test("discovers CSV uploads as generic tables and runs a plan", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA2,West,5")
  }];

  const snapshot = await discoverExcelFiles(files);
  assert.equal(snapshot.tables[0].name, "orders");
  assert.deepEqual(snapshot.tables[0].headers, ["Order", "Region", "Amount"]);
  assert.deepEqual(snapshot.profiles[0], {
    name: "orders",
    sourceFile: "orders.csv",
    rowCount: 2,
    headers: ["Order", "Region", "Amount"],
    sampleRows: [
      { Order: "A1", Region: "East", Amount: "10" },
      { Order: "A2", Region: "West", Amount: "5" }
    ],
    columnTypes: { Order: "text", Region: "text", Amount: "number" },
    candidateKeys: ["Order", "Region", "Amount"]
  });

  const result = await runExcelAnalysis(files, {
    operations: [{ id: "orders-by-region", kind: "group", inputTable: "orders", options: { groupBy: "Region", sumColumn: "Amount" } }]
  });
  assert.equal(result.operations[0].facts.groupCount, 2);
});

test("discovers a disk-backed CSV upload without Base64 conversion", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-upload-test-"));
  const filePath = path.join(directory, "orders.csv");
  await fs.writeFile(filePath, "Order,Amount\nA1,10\n");

  try {
    const snapshot = await discoverExcelFiles([{ fileName: "orders.csv", filePath, size: (await fs.stat(filePath)).size }]);
    assert.equal(snapshot.tables[0].sourceFile, "orders.csv");
    assert.deepEqual(snapshot.tables[0].rows, [{ Order: "A1", Amount: "10" }]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("repairs a grouped sum plan when the planner omits the numeric sum column", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA2,West,5\nA3,East,7")
  }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{ id: "orders-by-region", kind: "group", inputTable: "orders", options: { groupBy: "Region" } }]
  });

  const result = await runExcelPrompt(files, "Group the orders by Region and sum Amount", planner);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.deepEqual(result.analysis.operations[0].table?.headers, ["Region", "Count", "Sum of Amount"]);
  assert.deepEqual(result.analysis.operations[0].table?.rows, [
    { Region: "east", Count: 2, "Sum of Amount": 17 },
    { Region: "west", Count: 1, "Sum of Amount": 5 }
  ]);
});

test("asks which rows to compare when the prompt omits row numbers", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA2,West,5")
  }];
  let plannerCalled = false;
  const planner = async (): Promise<ExcelPromptPlan> => {
    plannerCalled = true;
    return { status: "ready", operations: [] };
  };

  const result = await runExcelPrompt(files, "Compare 2 Rows across all columns", planner);

  assert.deepEqual(result, {
    status: "needsClarification",
    questions: ["Which two Excel row numbers should I compare? For example: row 2 and row 3."]
  });
  assert.equal(plannerCalled, false);
});

test("uses row format for an explicit two-row comparison", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA1,West,10")
  }];

  const result = await runExcelPrompt(files, "Compare row 2 and row 3", injectedPlanner);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.deepEqual(result.analysis.operations[0].table?.headers, ["Order", "Region", "Amount"]);
  assert.deepEqual(result.analysis.operations[0].table?.rows, [
    { Order: "A1", Region: "East", Amount: "10" },
    { Order: "A1", Region: "West", Amount: "10" },
    { Order: true, Region: false, Amount: true }
  ]);
});

test("routes an explicit row comparison with export directly to local XLSX generation", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA1,West,10")
  }];
  const runtime = async (): Promise<never> => {
    throw new Error("runtime should not be called");
  };
  const fallback = async (): Promise<never> => {
    throw new Error("MCP fallback should not be called");
  };

  const result = await runExcelPrompt(files, "Compare row 2 and row 3 across all columns and export the results in Excel", injectedPlanner, fallback, {}, runtime);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.deepEqual(result.analysis.operations[0].table?.rows, [
    { Order: "A1", Region: "East", Amount: "10" },
    { Order: "A1", Region: "West", Amount: "10" },
    { Order: true, Region: false, Amount: true }
  ]);
  assert.equal(result.artifacts?.length, 1);
  const artifactId = result.artifacts?.[0]?.id;
  if (!artifactId) throw new Error("Expected a downloadable XLSX artifact.");
  const artifact = await resolveExcelArtifact(artifactId);
  if (!artifact) throw new Error("Expected the generated artifact to be persisted.");
  try {
    await JSZip.loadAsync(await fs.readFile(artifact.filePath));
  } finally {
    await fs.rm(artifact.filePath, { force: true });
  }
});

test("asks which rows to compare when a planner omits compare row numbers", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Region,Amount\nA1,East,10\nA2,West,5")
  }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{ id: "row-comparison", kind: "compareRows", inputTable: "orders", options: {} }]
  });

  const result = await runExcelPrompt(files, "Compare these rows across all columns", planner);

  assert.deepEqual(result, {
    status: "needsClarification",
    questions: ["Which two Excel row numbers should I compare? For example: row 2 and row 3."]
  });
});

test("repairs a malformed two-table row comparison into a keyed table comparison", async () => {
  const files = [
    { fileName: "old.csv", contentBase64: encode("Order,Event Date,Amount\nA1,2026-01-01,10\nA2,2026-01-02,20") },
    { fileName: "new.csv", contentBase64: encode("Order,Event Date,Amount\nA1,2026-01-03,10\nA2,2026-01-02,20") }
  ];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{ id: "comparison", kind: "compareRows", inputTable: "old", options: { rightTable: "new" } }]
  });

  const result = await runExcelPrompt(files, "Compare the two files and identify changed Event Date values", planner);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.equal(result.analysis.operations[0].kind, "compare");
  assert.deepEqual(result.analysis.operations[0].table?.rows, [
    { Order: "a1", Status: "MISMATCH", "Event Date (left)": "2026-01-01", "Amount (left)": "10" },
    { Order: "a2", Status: "MATCH", "Event Date (left)": "2026-01-02", "Amount (left)": "20" }
  ]);
});

test("rejects unsupported generic Excel input", async () => {
  await assert.rejects(
    () => discoverExcelFiles([{ fileName: "orders.txt", contentBase64: encode("not excel") }]),
    /only \.csv, \.xlsx, and \.zip files are supported/
  );
});

test("turns explicit value checks into a focused result", async () => {
  const files = [{
    fileName: "invoices.csv",
    contentBase64: encode("Trx No,Invoice,Invoice Date,Native Currency Amount,Supplier\n2220431-C0,0031092285,2026-08-27,14000.00,Unrequested value")
  }];
  const result = await runExcelPrompt(files, "check Trx No: 2220431-C0 Invoice: 0031092285 Invoice Date: 8/27/26 Native Currency Amount: 14,000", injectedPlanner);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.equal(result.analysis.operations[0].kind, "checkValues");
  assert.equal(result.analysis.operations[0].facts.valid, true);
  assert.deepEqual(result.analysis.operations[0].table?.headers, ["Column", "Expected", "Actual", "Match"]);
  assert.equal(result.analysis.operations[0].table?.rows.some((row) => row.Column === "Trx No" && row.Match === true), true);
  assert.equal(result.analysis.operations[0].table?.rows.some((row) => row.Column === "Supplier"), false);
});

test("asks for clarification when an exact transaction is missing", async () => {
  const files = [{
    fileName: "invoices.csv",
    contentBase64: encode("Trx No,Invoice,Invoice Date,Native Currency Amount\n2220431-C0,0031092285,2026-08-27,14000.00")
  }];
  const result = await runExcelPrompt(files, "Verify Trx No: 222043-co Invoice: 0031092285 Invoice Date: 8/27/26 Native Currency Amount: 14,000", injectedPlanner);

  assert.equal(result.status, "needsClarification");
  if (result.status !== "needsClarification") throw new Error("Expected clarification for a missing transaction.");
  assert.match(result.questions[0], /No row matched Trx No: 222043-co/);
});

test("asks for clarification when an exact transaction is duplicated", async () => {
  const files = [{
    fileName: "invoices.csv",
    contentBase64: encode("Trx No,Invoice\nTX-100,INV-1\nTX-100,INV-2")
  }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{
      id: "duplicate-check",
      kind: "checkValues",
      inputTable: "invoices",
      options: { matchColumn: "Trx No", matchValue: "TX-100", checks: [{ column: "Invoice", expected: "INV-1" }] }
    }]
  });

  const result = await runExcelPrompt(files, "Check transaction TX-100", planner);

  assert.equal(result.status, "needsClarification");
  if (result.status !== "needsClarification") throw new Error("Expected clarification for duplicate transactions.");
  assert.match(result.questions[0], /2 rows matched Trx No: TX-100/);
});

test("turns an old versus new prompt into a generic version comparison", async () => {
  const files = [
    { fileName: "old-orders.csv", contentBase64: encode("Event ID,Event Date,Amount\nA,2026-08-27,14000\nB,2026-08-28,10") },
    { fileName: "new-orders.csv", contentBase64: encode("Event ID,Event Date,Amount\nA,8/27/26,14000.00\nC,2026-08-29,20") }
  ];
  const result = await runExcelPrompt(files, "Compare old and new files by Event ID and show Event Date and Amount changes", injectedPlanner);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.equal(result.analysis.operations[0].kind, "compareVersions");
  assert.deepEqual(result.analysis.operations[0].facts, {
    oldTable: "old-orders",
    newTable: "new-orders",
    key: "Event ID",
    comparedColumns: 2,
    oldRows: 2,
    newRows: 2,
    changed: 0,
    added: 1,
    deleted: 1,
    unchanged: 1,
    valid: true
  });
});

test("routes a recognized version comparison directly to the local registry", async () => {
  const files = [
    { fileName: "old-orders.csv", contentBase64: encode("Event ID,Event Date,Amount\nA,2026-08-27,14000\nB,2026-08-28,10") },
    { fileName: "new-orders.csv", contentBase64: encode("Event ID,Event Date,Amount\nA,8/27/26,14000.00\nC,2026-08-29,20") }
  ];
  const runtime = async (): Promise<never> => {
    throw new Error("runtime should not be called for a recognized local plan");
  };
  const fallback = async (): Promise<never> => {
    throw new Error("MCP fallback should not be called for a recognized local plan");
  };

  const result = await runExcelPrompt(files, "Compare old and new files by Event ID and show Event Date and Amount changes", injectedPlanner, fallback, {}, runtime);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.equal(result.analysis.operations[0].kind, "compareVersions");
  assert.equal(result.analysis.operations[0].facts.changed, 0);
});

test("defers an unqualified multi-table comparison to the planner", async () => {
  const files = [
    { fileName: "source.csv", contentBase64: encode("Event ID,Amount\nA,10") },
    { fileName: "target.csv", contentBase64: encode("Event ID,Amount\nA,12") }
  ];
  let plannerCalled = false;
  const planner = async (): Promise<ExcelPromptPlan> => {
    plannerCalled = true;
    return { status: "needsClarification", questions: ["Which table is the baseline?"] };
  };

  const response = await runExcelPrompt(files, "Compare the tables by Event ID", planner);

  assert.equal(plannerCalled, true);
  assert.deepEqual(response, { status: "needsClarification", questions: ["Which table is the baseline?"] });
});

test("returns focused clarification questions without executing an operation", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nA,2026-09-01\nB,2026-09-02") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "needsClarification", questions: ["Which transaction should I use?"] });

  const response = await runExcelPrompt(files, "What is the event date?", planner);

  assert.deepEqual(response, { status: "needsClarification", questions: ["Which transaction should I use?"] });
});

test("asks for clarification instead of treating discovery as an answer to a data question", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nA,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{ id: "discover-event-dates", kind: "discover", options: {} }]
  });
  let fallbackCalled = false;
  const fallback = async (): Promise<ExcelMcpFallbackResult> => {
    fallbackCalled = true;
    return { answer: "unexpected", files: [], toolsUsed: [], provenance: { sourceFiles: [], tables: [] } };
  };

  const response = await runExcelPrompt(files, "What is the event date?", planner, fallback);

  assert.equal(response.status, "needsClarification");
  assert.equal(fallbackCalled, false);
});

test("allows discovery when the user explicitly asks about workbook structure", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nA,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{ id: "discover-sheets", kind: "discover", options: {} }]
  });

  const response = await runExcelPrompt(files, "List the workbook tables", planner);

  assert.equal(response.status, "completed");
});

test("uses the MCP fallback only when the planner returns a clear unsupported request", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "unsupported", reason: "The request needs a pivot report." });
  const fallback = async (): Promise<ExcelMcpFallbackResult> => ({
    answer: "The pivot summary contains one transaction dated 2026-09-01.",
    files: ["events.csv"],
    toolsUsed: ["excel-mcp_read_cells"],
    provenance: { sourceFiles: ["events.csv"], tables: [] }
  });

  const response = await runExcelPrompt(files, "Create a pivot summary by event date", planner, fallback);

  assert.deepEqual(response, {
    status: "mcpCompleted",
    answer: "The pivot summary contains one transaction dated 2026-09-01.",
    source: "mbeps/excel-mcp",
    files: ["events.csv"],
    artifacts: [],
    toolsUsed: ["excel-mcp_read_cells"],
    provenance: { sourceFiles: ["events.csv"], tables: [] },
    localVerification: "not-performed"
  });
});

test("uses the MCP fallback when the planner explicitly selects MCP", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "mcp", reason: "The request needs a pivot report." });
  let fallbackPrompt = "";
  const fallback = async (_files: unknown, prompt: string): Promise<ExcelMcpFallbackResult> => {
    fallbackPrompt = prompt;
    return { answer: "MCP answer", files: ["events.csv"], toolsUsed: ["excel-mcp_read_cells"], provenance: { sourceFiles: ["events.csv"], tables: [] } };
  };

  const response = await runExcelPrompt(files, "Create a pivot summary by event date", planner, fallback);

  assert.equal(response.status, "mcpCompleted");
  assert.match(fallbackPrompt, /Local analysis limitation: The request needs a pivot report\./);
});

test("accepts MCP filenames normalized for staging", async () => {
  const files = [{
    fileName: "VSA OIC Booking Feed Incremental Extract Test Case 9 (1).csv",
    contentBase64: encode("Column A,Column B\nold,new")
  }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "mcp", reason: "Needs a workbook comparison." });
  const fallback = async (): Promise<ExcelMcpFallbackResult> => ({
    answer: "The rows were compared.",
    files: ["001-VSA_OIC_Booking_Feed_Incremental_Extract_Test_Case_9__1_.csv"],
    toolsUsed: ["excel-mcp_read_cells"],
    provenance: {
      sourceFiles: ["001-VSA_OIC_Booking_Feed_Incremental_Extract_Test_Case_9__1_.csv"],
      tables: []
    }
  });

  const response = await runExcelPrompt(files, "Compare the rows", planner, fallback);

  assert.equal(response.status, "mcpCompleted");
});

test("formats autonomous runtime failures for direct callers", () => {
  assert.deepEqual(autonomousRuntimeFailureResponse(new Error("session idle timeout")), {
    status: "unsupported",
    reason: "Autonomous Excel execution failed without starting a second MCP session: session idle timeout"
  });
});

test("rejects MCP answers without valid provenance", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction, Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "mcp", reason: "The request needs a pivot report." });
  const fallback = async (): Promise<ExcelMcpFallbackResult> => ({ answer: "Unverified answer", files: ["other.csv"], toolsUsed: ["excel-mcp_read_cells"], provenance: { sourceFiles: ["other.csv"], tables: [] } });

  const response = await runExcelPrompt(files, "Create a pivot summary", planner, fallback);

  assert.equal(response.status, "unsupported");
  if (response.status === "unsupported") assert.match(response.reason, /was not uploaded/);
});

test("rejects MCP answers that cite unknown workbook tables or columns", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "mcp", reason: "Needs a pivot report." });
  const fallback = async (): Promise<ExcelMcpFallbackResult> => ({
    answer: "Unverified answer",
    files: ["events.csv"],
    toolsUsed: ["excel-mcp_read_cells"],
    provenance: {
      sourceFiles: ["events.csv"],
      tables: [{ sourceFile: "events.csv", tableName: "events", columns: ["Missing Column"] }]
    }
  });

  const response = await runExcelPrompt(files, "Create a pivot summary", planner, fallback);

  assert.equal(response.status, "unsupported");
  if (response.status === "unsupported") assert.match(response.reason, /unknown column/);
});

test("reports MCP fallback failures as unsupported rather than a successful answer", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "unsupported", reason: "Needs a pivot report." });
  const fallback = async (): Promise<ExcelMcpFallbackResult> => { throw new Error("server unavailable"); };

  const response = await runExcelPrompt(files, "Create a pivot summary", planner, fallback);

  assert.equal(response.status, "unsupported");
  if (response.status === "unsupported") assert.match(response.reason, /server unavailable/);
});

test("preserves telemetry from a classified MCP idle timeout response", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({ status: "mcp", reason: "Needs a pivot report." });
  const telemetry = {
    sessionId: "idle-timeout-session",
    turns: 2,
    turnIds: ["1", "2"],
    toolCalls: 3,
    idle: false,
    errors: [],
    taskComplete: false,
    eventTypes: [],
    waitOutcome: "idleTimeout" as const,
    applicationCompletionRecorded: false,
    excelFinishRecorded: false,
    mcpToolLifecycle: {
      started: 2,
      completed: 1,
      failed: 0,
      denied: 0,
      inFlight: 1,
      totalDurationMs: 47,
      lastToolName: "read_cells",
      calls: []
    }
  };
  const fallback = async (): Promise<ExcelMcpFallbackResult> => {
    throw new ExcelSessionWaitError("Timeout after 120000ms waiting for session.idle", telemetry);
  };

  const response = await runExcelPrompt(files, "Create a pivot summary", planner, fallback);

  assert.equal(response.status, "unsupported");
  if (response.status === "unsupported") {
    assert.match(response.reason, /Timeout after 120000ms waiting for session\.idle/);
    assert.equal(response.telemetry, telemetry);
    assert.equal(response.telemetry?.waitOutcome, "idleTimeout");
    assert.equal(response.telemetry?.mcpToolLifecycle?.inFlight, 1);
    assert.equal(response.telemetry?.idle, false);
  }
});

test("uses a typed lookup plan to return the requested field for a matching record", async () => {
  const files = [{ fileName: "events.csv", contentBase64: encode("Transaction,Event Date\nTX-100,2026-09-01\nTX-200,2026-09-02") }];
  const planner = async (): Promise<ExcelPromptPlan> => ({
    status: "ready",
    operations: [{
      id: "event-date",
      kind: "lookup",
      inputTable: "events",
      options: { filters: [{ column: "Transaction", value: "TX-200" }], columns: ["Event Date"] }
    }]
  });

  const response = await runExcelPrompt(files, "What is the event date for transaction TX-200?", planner);

  assert.equal(response.status, "completed");
  if (response.status !== "completed") throw new Error("Expected a completed Excel prompt response.");
  assert.deepEqual(response.analysis.operations[0].table?.rows, [{ "Event Date": "2026-09-02" }]);
});

test("rejects execution plans whose operation inputs diverge from declarations", () => {
  assert.throws(() => validateExecutionPlanShape({
    status: "ready",
    operations: [{ id: "lookup-event", kind: "lookup", inputTable: "events", options: { columns: ["Event Date"], filters: [{ column: "Transaction", value: "TX-100" }] } }],
    executionPlan: {
      steps: [{
        id: "lookup-event",
        capability: "local-registry",
        operation: { id: "lookup-event", kind: "lookup", inputTable: "events", options: { columns: ["Event Date"], filters: [{ column: "Transaction", value: "TX-200" }] } }
      }]
    }
  }), /match the declared operations/);
});

test("requires XLSX export to be the final execution-plan step", () => {
  assert.throws(() => validateExecutionPlanShape({
    status: "ready",
    operations: [{ id: "summarize-events", kind: "summarize", inputTable: "events", options: { sumColumn: "Amount" } }],
    export: { format: "xlsx", fileName: "summary.xlsx" },
    executionPlan: {
      steps: [
        { id: "export-xlsx", capability: "local-registry", export: { format: "xlsx", fileName: "summary.xlsx" } },
        { id: "summarize-events", capability: "local-registry", operation: { id: "summarize-events", kind: "summarize", inputTable: "events", options: { sumColumn: "Amount" } } }
      ]
    }
  }), /export must be the final/);
});

test("default prompt orchestration starts the Copilot agent runtime directly", async () => {
  const files = [{
    fileName: "orders.csv",
    contentBase64: encode("Order,Amount\nA1,10\n")
  }];
  let runtimeInput: { prompt: string; executionPlan?: unknown } | undefined;
  let fallbackCalled = false;
  const fallback = async (): Promise<ExcelMcpFallbackResult> => {
    fallbackCalled = true;
    return { answer: "unexpected", files: [], toolsUsed: [], provenance: { sourceFiles: [], tables: [] } };
  };
  const runtime = async (input: { prompt: string; executionPlan?: unknown }): Promise<ExcelPromptResponse> => {
    runtimeInput = input;
    return { status: "needsClarification", questions: ["Which table should be used?"] };
  };

  const result = await runExcelPrompt(files, "Give me the total amount", undefined, fallback, {}, runtime as never);

  assert.deepEqual(result, { status: "needsClarification", questions: ["Which table should be used?"] });
  assert.equal(runtimeInput?.prompt, "Give me the total amount");
  assert.equal(runtimeInput?.executionPlan, undefined);
  assert.equal(fallbackCalled, false);
});
