import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { adaptTransactionFiles } from "./transactionFileAdapter.js";

const headers = "transaction number,transaction amount (source currency),source currency code";

function encoded(fileName: string, content: string): { fileName: string; contentBase64: string } {
  return { fileName, contentBase64: Buffer.from(content).toString("base64") };
}

test("adapts CSV files and ZIP members into transaction rows", async () => {
  const zip = new JSZip();
  zip.file("orders.csv", [headers, "1001,10.25,USD", "1002,-2.25,USD"].join("\n"));
  const content = await zip.generateAsync({ type: "nodebuffer" });

  const files = await adaptTransactionFiles([
    { fileName: "orders.zip", contentBase64: content.toString("base64") }
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "orders.zip#orders.csv");
  assert.deepEqual(files[0].rows[1], ["1001", "10.25", "USD"]);
});

test("accepts twenty CSV files after ZIP expansion", async () => {
  const zip = new JSZip();
  for (let index = 0; index < 20; index += 1) {
    zip.file(`file-${index + 1}.csv`, headers);
  }
  const content = await zip.generateAsync({ type: "nodebuffer" });

  const files = await adaptTransactionFiles([
    { fileName: "batch.zip", contentBase64: content.toString("base64") }
  ]);

  assert.equal(files.length, 20);
});

test("rejects more than twenty CSV files after ZIP expansion", async () => {
  const zip = new JSZip();
  for (let index = 0; index < 21; index += 1) {
    zip.file(`file-${index + 1}.csv`, headers);
  }
  const content = await zip.generateAsync({ type: "nodebuffer" });

  await assert.rejects(
    () => adaptTransactionFiles([{ fileName: "batch.zip", contentBase64: content.toString("base64") }]),
    /at most 20 CSV\/XLSX files after ZIP expansion/
  );
});

test("adapts XLSX worksheet rows", async () => {
  const workbook = new JSZip();
  workbook.file("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>');
  workbook.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>');
  workbook.file("xl/worksheets/sheet1.xml", [
    '<worksheet><sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>transaction number</t></is></c><c r="B1" t="inlineStr"><is><t>transaction amount (source currency)</t></is></c><c r="C1" t="inlineStr"><is><t>source currency code</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>1001</t></is></c><c r="B2"><v>12.50</v></c><c r="C2" t="inlineStr"><is><t>USD</t></is></c></row>',
    '</sheetData></worksheet>'
  ].join(""));
  const content = await workbook.generateAsync({ type: "nodebuffer" });

  const files = await adaptTransactionFiles([
    { fileName: "orders.xlsx", contentBase64: content.toString("base64") }
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0].fileName, "orders.xlsx");
  assert.deepEqual(files[0].rows[1], ["1001", "12.50", "USD"]);
});

test("adapts a disk-backed upload without Base64 conversion", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "transaction-upload-test-"));
  const filePath = path.join(directory, "orders.csv");
  await fs.writeFile(filePath, [headers, "1001,10.25,USD"].join("\n"));

  try {
    const files = await adaptTransactionFiles([{ fileName: "orders.csv", filePath, size: (await fs.stat(filePath)).size }]);
    assert.equal(files[0].fileName, "orders.csv");
    assert.deepEqual(files[0].rows[1], ["1001", "10.25", "USD"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
