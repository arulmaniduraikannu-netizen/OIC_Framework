import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCsvBatch, analyzeCsvContent } from "./transactionAnalysis.js";

const headers = "transaction number,transaction amount (source currency),source currency code";

test("counts rows and sums decimal and negative amounts", () => {
  const result = analyzeCsvContent([
    headers,
    "1001,100.25,USD",
    "1002,-25.50,USD",
    "1003,0.25,USD"
  ].join("\n"), "sample.csv");

  assert.equal(result.transactionNumberCount, 3);
  assert.equal(result.amountSum, "75");
  assert.deepEqual(result.currencyTotals, [{ currency: "USD", amountSum: "75" }]);
});

test("counts duplicate transaction numbers as separate rows", () => {
  const result = analyzeCsvContent([
    headers,
    "1001,10,USD",
    "1001,20,USD"
  ].join("\n"), "duplicates.csv");

  assert.equal(result.transactionNumberCount, 2);
  assert.equal(result.amountSum, "30");
});

test("excludes blank transaction numbers from the count", () => {
  const result = analyzeCsvContent([
    headers,
    "1001,10,USD",
    ",20,USD",
    "   ,30,USD"
  ].join("\n"), "blank-transaction.csv");

  assert.equal(result.transactionNumberCount, 1);
  assert.equal(result.amountSum, "60");
});

test("reports invalid and blank amounts without dropping the transaction count", () => {
  const result = analyzeCsvContent([
    headers,
    "1001,10,USD",
    "1002,not-a-number,USD",
    "1003,,USD"
  ].join("\n"), "invalid-amount.csv");

  assert.equal(result.transactionNumberCount, 3);
  assert.equal(result.amountSum, "10");
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.rowNumber), [3, 4]);
});

test("preserves an embedded unescaped quote in a source field", () => {
  const result = analyzeCsvContent([
    headers,
    '1001,10,USD',
    '1002,20,"EUR" partner"'
  ].join("\n"), "embedded-quote.csv");

  assert.equal(result.transactionNumberCount, 2);
  assert.equal(result.amountSum, "30");
  assert.deepEqual(result.currencyTotals, [{ currency: 'EUR" partner', amountSum: "20" }, { currency: "USD", amountSum: "10" }]);
});

test("warns and separates totals for mixed currencies", () => {
  const result = analyzeCsvContent([
    headers,
    "1001,10,USD",
    "1002,20,EUR"
  ].join("\n"), "mixed-currency.csv");

  assert.equal(result.amountSum, "30");
  assert.deepEqual(result.currencyTotals, [
    { currency: "EUR", amountSum: "20" },
    { currency: "USD", amountSum: "10" }
  ]);
  assert.equal(result.warnings.length, 1);
});

test("aggregates one file and preserves file-level results", () => {
  const result = analyzeCsvBatch([{ fileName: "one.csv", content: [headers, "1001,10,USD"].join("\n") }]);

  assert.equal(result.fileCount, 1);
  assert.equal(result.transactionNumberCount, 1);
  assert.equal(result.amountSum, "10");
  assert.equal(result.files[0].fileName, "one.csv");
});

test("aggregates a twenty-file batch", () => {
  const inputs = Array.from({ length: 20 }, (_, index) => ({
    fileName: `file-${index + 1}.csv`,
    content: [headers, `${index + 1},${index + 1}.25,USD`].join("\n")
  }));
  const result = analyzeCsvBatch(inputs);

  assert.equal(result.fileCount, 20);
  assert.equal(result.rowCount, 20);
  assert.equal(result.transactionNumberCount, 20);
  assert.equal(result.amountSum, "215");
});

test("rejects batches larger than twenty files", () => {
  const inputs = Array.from({ length: 21 }, (_, index) => ({
    fileName: `file-${index + 1}.csv`,
    content: [headers, "1,1,USD"].join("\n")
  }));

  assert.throws(() => analyzeCsvBatch(inputs), /at most 20/);
});