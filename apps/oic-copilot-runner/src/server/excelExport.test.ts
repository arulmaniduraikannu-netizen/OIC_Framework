import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { writeExcelTable } from "./excelExport.js";
import { parseWorkbookTables } from "./excelParser.js";

test("writes a downloadable XLSX workbook for a result table", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-export-test-"));
  try {
    const outputPath = await writeExcelTable(directory, {
      name: "row comparison",
      headers: ["Id", "Status", "Amount"],
      rows: [{ Id: true, Status: true, Amount: false }]
    }, "row-comparison.xlsx");
    const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
    const worksheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    const workbook = await zip.file("xl/workbook.xml")?.async("string");
    assert.equal(path.basename(outputPath), "row-comparison.xlsx");
    assert.equal((workbook?.match(/<sheet\b/g) ?? []).length, 1);
    assert.match(worksheet ?? "", /Amount/);
    assert.match(worksheet ?? "", /r="A2"[^>]*s="2"/);
    assert.match(worksheet ?? "", /r="B2"[^>]*s="2"/);
    assert.match(worksheet ?? "", /r="C2"[^>]*s="3"/);
    assert.match(worksheet ?? "", />TRUE<\/t>/);
    assert.match(worksheet ?? "", />FALSE<\/t>/);
    assert.match(await zip.file("xl/styles.xml")?.async("string") ?? "", /FFC6EFCE/);
    assert.match(await zip.file("xl/styles.xml")?.async("string") ?? "", /FFFFC7CE/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("preserves date semantics and ordinary numeric values through XLSX parsing and export", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-typed-export-test-"));
  try {
    const source = new JSZip();
    source.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    source.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    source.file("xl/styles.xml", `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`);
    source.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Number</t></is></c></row><row r="2"><c r="A2" s="1" t="n"><v>46192</v></c><c r="B2" t="n"><v>46192</v></c></row></sheetData></worksheet>`);

    const parsed = await parseWorkbookTables(await source.generateAsync({ type: "nodebuffer" }));
    assert.deepEqual(parsed[0]?.rows[1], [
      { kind: "date", value: new Date("2026-06-19T00:00:00.000Z"), format: "yyyy-mm-dd" },
      { kind: "number", value: 46192 }
    ]);

    const outputPath = await writeExcelTable(directory, {
      name: "typed",
      headers: ["Date", "Number"],
      rows: [{ Date: { kind: "date", value: new Date("2026-06-19T00:00:00.000Z"), format: "yyyy-mm-dd" }, Number: 46192 }]
    });
    const output = await JSZip.loadAsync(await fs.readFile(outputPath));
    const worksheet = await output.file("xl/worksheets/sheet1.xml")?.async("string");
    const styles = await output.file("xl/styles.xml")?.async("string");
    assert.match(worksheet ?? "", /r="A2" s="4" t="n"><v>46192<\/v>/);
    assert.match(worksheet ?? "", /r="B2" t="n"><v>46192<\/v>/);
    assert.match(styles ?? "", /formatCode="yyyy-mm-dd"/);

    const nextOutputPath = await writeExcelTable(directory, {
      name: "another-typed-table",
      headers: ["Date"],
      rows: [{ Date: { kind: "date", value: new Date("2026-06-19T00:00:00.000Z"), format: "dd/mm/yyyy" } }]
    });
    const nextOutput = await JSZip.loadAsync(await fs.readFile(nextOutputPath));
    const nextWorksheet = await nextOutput.file("xl/worksheets/sheet1.xml")?.async("string");
    const nextStyles = await nextOutput.file("xl/styles.xml")?.async("string");
    assert.match(nextWorksheet ?? "", /r="A2" s="4" t="n"><v>46192<\/v>/);
    assert.match(nextStyles ?? "", /formatCode="dd\/mm\/yyyy"/);
    assert.doesNotMatch(nextStyles ?? "", /formatCode="yyyy-mm-dd"/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
