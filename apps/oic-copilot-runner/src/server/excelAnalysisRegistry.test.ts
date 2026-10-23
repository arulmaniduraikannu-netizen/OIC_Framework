import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultExcelOperationRegistry, ExcelOperationRegistry, tableFromRows } from "./excelAnalysisRegistry.js";

const registry = createDefaultExcelOperationRegistry();

test("requires capability metadata to match each executable registration", () => {
  const custom = new ExcelOperationRegistry();
  assert.throws(() => custom.register({
    kind: "discover",
    capability: {
      id: "filter",
      description: "misaligned",
      requiredInputs: [],
      optionalInputs: [],
      tableScope: "none",
      rowScope: "wholeTable",
      resultType: "metadata",
      createsArtifact: false,
      limitations: []
    },
    execute: () => ({ operationId: "x", kind: "discover", facts: {}, diagnostics: [] })
  }), /does not match registered operation/);
});

test("runs generic filter and group operations without Copilot", () => {
  const sales = tableFromRows("Sales", [
    ["Region", "Owner", "Amount"],
    ["East", "Ana", "10.50"],
    ["East", "Ben", "4.50"],
    ["West", "Ana", "8"]
  ]);

  const result = registry.execute({ operations: [
    { id: "east", kind: "filter", inputTable: "Sales", options: { column: "Region", value: "East" } },
    { id: "by-owner", kind: "group", inputTable: "Sales_filtered", options: { groupBy: "Owner", sumColumn: "Amount" } }
  ] }, [sales]);

  assert.equal(result.operations[0].table?.rows.length, 2);
  assert.deepEqual(result.operations[1].table?.rows, [
    { Owner: "ana", Count: 1, "Sum of Amount": 10.5 },
    { Owner: "ben", Count: 1, "Sum of Amount": 4.5 }
  ]);
});

test("looks up matching rows and returns only requested columns", () => {
  const events = tableFromRows("Events", [
    ["Transaction", "Event Date", "Region"],
    ["TX-100", "2026-09-01", "East"],
    ["TX-200", "2026-09-02", "West"]
  ]);

  const result = registry.execute({ operations: [{
    id: "event-date",
    kind: "lookup",
    inputTable: "Events",
    options: { filters: [{ column: "Transaction", value: "TX-200" }], columns: ["Event Date"] }
  }] }, [events]);

  assert.deepEqual(result.operations[0].table?.rows, [{ "Event Date": "2026-09-02" }]);
  assert.deepEqual(result.operations[0].table?.headers, ["Event Date"]);
  assert.equal(result.operations[0].facts.matchedRows, 1);
  assert.deepEqual(events.rows[0], { Transaction: "TX-100", "Event Date": "2026-09-01", Region: "East" });
});

test("returns all matching lookup rows and reports an empty match clearly", () => {
  const events = tableFromRows("Events", [
    ["Transaction", "Event Date"],
    ["TX-100", "2026-09-01"],
    ["TX-101", "2026-09-02"],
    ["TX-200", "2026-09-03"]
  ]);

  const matches = registry.execute({ operations: [{
    id: "matching-dates",
    kind: "lookup",
    inputTable: "Events",
    options: { filters: [{ column: "Transaction", value: "TX-10", mode: "contains" }], columns: ["Event Date"] }
  }] }, [events]);
  const empty = registry.execute({ operations: [{
    id: "missing-transaction",
    kind: "lookup",
    inputTable: "Events",
    options: { filters: [{ column: "Transaction", value: "TX-999" }], columns: ["Event Date"] }
  }] }, [events]);

  assert.equal(matches.operations[0].table?.rows.length, 2);
  assert.equal(matches.operations[0].facts.matchedRows, 2);
  assert.deepEqual(empty.operations[0].table?.rows, []);
  assert.equal(empty.operations[0].diagnostics[0].code, "NO_MATCHING_ROWS");
});

test("rejects lookup columns that are not present in the source table", () => {
  const events = tableFromRows("Events", [["Transaction", "Event Date"], ["TX-100", "2026-09-01"]]);
  const result = registry.execute({ operations: [{
    id: "invalid-column",
    kind: "lookup",
    inputTable: "Events",
    options: { filters: [{ column: "Transaction", value: "TX-100" }], columns: ["Posting Date"] }
  }] }, [events]);

  assert.equal(result.operations[0].diagnostics[0].code, "OPERATION_FAILED");
  assert.match(result.operations[0].diagnostics[0].message, /Column Posting Date was not found/);
});

test("compares tables and reports validation diagnostics", () => {
  const source = tableFromRows("Source", [["Id", "Status"], ["A", "Ready"], ["B", "Pending"]]);
  const target = tableFromRows("Target", [["Id", "Status"], ["A", "Ready"], ["B", "Done"]]);
  const result = registry.execute({ operations: [
    { id: "comparison", kind: "compare", inputTable: "Source", options: { rightTable: "Target", key: "Id", columns: ["Status"] } },
    { id: "validation", kind: "validate", inputTable: "Source", options: { requiredColumns: ["Id", "Missing"], uniqueColumn: "Id" } }
  ] }, [source, target]);

  assert.equal(result.operations[0].facts.mismatched, 1);
  assert.equal(result.operations[1].facts.valid, false);
  assert.equal(result.operations[1].diagnostics[0].code, "MISSING_COLUMN");
});

test("compares two Excel rows across every column with boolean results", () => {
  const table = tableFromRows("Invoices", [
    ["Id", "Status", "Amount"],
    ["A", "BOOKED", "10"],
    ["A", "BOOKED", "12"]
  ]);
  const result = registry.execute({ operations: [
    { id: "row-comparison", kind: "compareRows", inputTable: "Invoices", options: { firstRow: 2, secondRow: 3 } }
  ] }, [table]);

  assert.deepEqual(result.operations[0].table?.headers, ["Id", "Status", "Amount"]);
    assert.deepEqual(result.operations[0].table?.rows, [
    { Id: "A", Status: "BOOKED", Amount: "10" },
      { Id: "A", Status: "BOOKED", Amount: "12" },
    { Id: true, Status: true, Amount: false }
    ]);
  assert.equal(result.operations[0].facts.overallMatch, false);
});

test("summarizes numeric values with total and count", () => {
  const table = tableFromRows("Invoices", [
    ["Transaction Amount"],
    ["10.50"],
    ["4.50"],
    ["not-a-number"]
  ]);
  const result = registry.execute({ operations: [
    { id: "summary", kind: "summarize", inputTable: "Invoices", options: { sumColumn: "Transaction Amount" } }
  ] }, [table]);

  assert.deepEqual(result.operations[0].table?.rows, [{ Column: "Transaction Amount", Count: 2, Total: 15 }]);
  assert.equal(result.operations[0].diagnostics[0].code, "NON_NUMERIC_VALUE");
});

test("validates blank, numeric, date, and allowed-value rules with row diagnostics", () => {
  const table = tableFromRows("Employees", [
    ["Name", "Amount", "Start Date", "Status"],
    ["Ana", "10", "2026-01-01", "Ready"],
    ["", "not-a-number", "not-a-date", "Unknown"]
  ]);
  const result = registry.execute({ operations: [
    {
      id: "quality",
      kind: "validate",
      inputTable: "Employees",
      options: {
        nonBlankColumns: ["Name"],
        numericColumns: ["Amount"],
        dateColumns: ["Start Date"],
        allowedValues: { Status: ["Ready", "Pending"] }
      }
    }
  ] }, [table]);

  assert.equal(result.operations[0].facts.valid, false);
  assert.deepEqual(result.operations[0].diagnostics.map((diagnostic) => diagnostic.code), [
    "BLANK_VALUE",
    "NON_NUMERIC_VALUE",
    "INVALID_DATE",
    "VALUE_NOT_ALLOWED"
  ]);
  assert.equal(result.operations[0].diagnostics[0].rowNumber, 3);
});

test("checks only requested values and normalizes currency and dates", () => {
  const table = tableFromRows("Invoices", [
    ["Trx No", "Invoice", "Invoice Date", "Native Currency Amount", "Supplier"],
    ["2220431-C0", "0031092285", "2026-08-27", "14000.00", "Only returned when requested"]
  ]);
  const result = registry.execute({ operations: [
    {
      id: "value-check",
      kind: "checkValues",
      inputTable: "Invoices",
      options: {
        matchColumn: "Trx No",
        matchValue: "2220431-C0",
        checks: [
          { column: "Invoice", expected: "0031092285" },
          { column: "Invoice Date", expected: "8/27/26" },
          { column: "Native Currency Amount", expected: "14,000" }
        ]
      }
    }
  ] }, [table]);

  assert.equal(result.operations[0].facts.valid, true);
  assert.deepEqual(result.operations[0].table?.rows, [
    { Column: "Invoice", Expected: "0031092285", Actual: "0031092285", Match: true },
    { Column: "Invoice Date", Expected: "8/27/26", Actual: "2026-08-27", Match: true },
    { Column: "Native Currency Amount", Expected: "14,000", Actual: "14000.00", Match: true }
  ]);
  assert.deepEqual(result.operations[0].table?.headers, ["Column", "Expected", "Actual", "Match"]);
});

test("compares old and new versions with normalized values and change classifications", () => {
  const oldTable = tableFromRows("old-orders", [
    ["Event ID", "Event Date", "Amount", "Status"],
    ["A", "2026-08-27", "14,000", "Open"],
    ["B", "2026-08-28", "10", "Open"],
    ["C", "2026-08-29", "20", "Open"]
  ]);
  const newTable = tableFromRows("new-orders", [
    ["Event ID", "Event Date", "Amount", "Status"],
    ["A", "8/27/26", "14000.00", "Closed"],
    ["B", "2026-08-28", "10", "Open"],
    ["D", "2026-08-30", "30", "Open"]
  ]);

  const result = registry.execute({ operations: [{
    id: "version-comparison",
    kind: "compareVersions",
    options: { oldTable: "old-orders", newTable: "new-orders", key: "Event ID", columns: ["Event Date", "Amount", "Status"] }
  }] }, [oldTable, newTable]);

  assert.deepEqual(result.operations[0].table?.rows, [
    { "Event ID": "a", Status: "CHANGED", "Event Date (old)": "2026-08-27", "Event Date (new)": "8/27/26", "Amount (old)": "14,000", "Amount (new)": "14000.00", "Status (old)": "Open", "Status (new)": "Closed" },
    { "Event ID": "c", Status: "DELETED", "Event Date (old)": "2026-08-29", "Event Date (new)": "", "Amount (old)": "20", "Amount (new)": "", "Status (old)": "Open", "Status (new)": "" },
    { "Event ID": "d", Status: "ADDED", "Event Date (old)": "", "Event Date (new)": "2026-08-30", "Amount (old)": "", "Amount (new)": "30", "Status (old)": "", "Status (new)": "Open" }
  ]);
  assert.deepEqual(result.operations[0].facts, {
    oldTable: "old-orders",
    newTable: "new-orders",
    key: "Event ID",
    comparedColumns: 3,
    oldRows: 3,
    newRows: 3,
    changed: 1,
    added: 1,
    deleted: 1,
    unchanged: 1,
    valid: true
  });
});

test("treats Excel serial dates as equivalent to displayed dates only in date columns", () => {
  const oldTable = tableFromRows("old-events", [
    ["Transaction", "Event Date", "Amount"],
    ["906467", "2026-07-16", "46219"],
    ["906460", "2026-07-16", "46219"]
  ]);
  const newTable = tableFromRows("new-events", [
    ["Transaction", "Event Date", "Amount"],
    ["906467", "2026-07-16", "46219"],
    ["906460", "2026-09-16", "46219"]
  ]);
  newTable.rows[0]["Event Date"] = 46219;
  newTable.rows[1]["Event Date"] = 46281;

  const result = registry.execute({ operations: [{
    id: "serial-date-comparison",
    kind: "compareVersions",
    options: { oldTable: "old-events", newTable: "new-events", key: "Transaction", columns: ["Event Date"] }
  }] }, [oldTable, newTable]);

  assert.deepEqual(result.operations[0].table?.rows, [
    { Transaction: "906460", Status: "CHANGED", "Event Date (old)": "2026-07-16", "Event Date (new)": 46281 },
  ]);
  assert.equal(result.operations[0].facts.changed, 1);
  assert.equal(result.operations[0].facts.unchanged, 1);
});
