import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { persistExcelArtifacts, resolveExcelArtifact } from "./excelArtifactStore.js";

test("persists generated Excel files and resolves them by opaque id", async () => {
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-artifact-test-"));
  const generatedPath = path.join(stagingDirectory, "row-comparison.xlsx");
  await fs.writeFile(path.join(stagingDirectory, "input.xlsx"), "source");
  await fs.writeFile(generatedPath, "generated workbook");

  try {
    const artifacts = await persistExcelArtifacts(stagingDirectory, [path.join(stagingDirectory, "input.xlsx")]);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].fileName, "row-comparison.xlsx");
    assert.match(artifacts[0].downloadUrl, new RegExp(`/api/excel-analysis/artifacts/${artifacts[0].id}$`));

    const resolved = await resolveExcelArtifact(artifacts[0].id);
    assert.equal(resolved?.fileName, "row-comparison.xlsx");
    assert.equal(await fs.readFile(resolved!.filePath, "utf8"), "generated workbook");
    assert.equal(await resolveExcelArtifact("../../input"), undefined);
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
});

test("keeps only the comparison worksheet for comparison artifacts", async () => {
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-comparison-artifact-test-"));
  const generatedPath = path.join(stagingDirectory, "comparison.xlsx");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types><Override PartName="/xl/worksheets/sheet1.xml"/><Override PartName="/xl/worksheets/sheet2.xml"/></Types>`);
  zip.file("xl/workbook.xml", `<workbook><sheets><sheet name="Source" sheetId="1" r:id="rId1"/><sheet name="Comparison" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", "source");
  zip.file("xl/worksheets/sheet2.xml", "<worksheet><sheetData><row r=\"2\"><c r=\"A2\"><f>Source!A2=Source!B2</f><v>1</v></c><c r=\"B2\" t=\"str\"><f>Source!C2</f><v>TRUE</v></c></row></sheetData></worksheet>");
  await fs.writeFile(generatedPath, await zip.generateAsync({ type: "nodebuffer" }));

  try {
    const artifacts = await persistExcelArtifacts(stagingDirectory, [], { comparisonOnly: true });
    assert.equal(artifacts.length, 1);
    const resultZip = await JSZip.loadAsync(await fs.readFile(generatedPath));
    const workbook = await resultZip.file("xl/workbook.xml")?.async("string");
    assert.match(workbook ?? "", /name="Comparison"/);
    assert.doesNotMatch(workbook ?? "", /name="Source"/);
    assert.equal(resultZip.file("xl/worksheets/sheet1.xml"), null);
    const comparison = await resultZip.file("xl/worksheets/sheet2.xml")?.async("string");
    assert.ok(comparison);
    assert.doesNotMatch(comparison, /<f\b/);
    assert.match(comparison, /<v>1<\/v>/);
    assert.match(comparison, /<v>TRUE<\/v>/);
    assert.doesNotMatch(comparison, /#REF!/);
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
});

test("rejects malformed comparison artifacts instead of exposing them as XLSX", async () => {
  const stagingDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "excel-invalid-comparison-artifact-test-"));
  const generatedPath = path.join(stagingDirectory, "comparison.xlsx");
  await fs.writeFile(generatedPath, "not an xlsx package");

  try {
    await assert.rejects(
      persistExcelArtifacts(stagingDirectory, [], { comparisonOnly: true }),
      /Invalid Excel MCP artifact: comparison\.xlsx is not a valid XLSX ZIP package/
    );
  } finally {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
  }
});