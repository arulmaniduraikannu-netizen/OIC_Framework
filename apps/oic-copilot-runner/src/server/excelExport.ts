import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { ExcelCell, ExcelTable, ExcelValue } from "../shared/types.js";

export async function writeExcelTable(outputDirectory: string, table: ExcelTable, requestedName?: string): Promise<string> {
  await fs.mkdir(outputDirectory, { recursive: true });
  const fileName = safeXlsxName(requestedName ?? `${table.name}.xlsx`);
  const formatStyles = collectDateFormats(table);
  const workbook = new JSZip();
  workbook.file("[Content_Types].xml", contentTypesXml());
  workbook.file("_rels/.rels", relationshipsXml());
  workbook.file("xl/workbook.xml", workbookXml(table.name));
  workbook.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml());
  workbook.file("xl/styles.xml", stylesXml(formatStyles));
  workbook.file("xl/worksheets/sheet1.xml", worksheetXml(table, formatStyles));
  const outputPath = path.join(outputDirectory, fileName);
  await fs.writeFile(outputPath, await workbook.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

function safeXlsxName(value: string): string {
  const baseName = path.basename(value).replace(/[^a-z0-9._-]/gi, "_");
  const withoutExtension = baseName.replace(/\.xlsx$/i, "");
  return `${withoutExtension || "excel-output"}.xlsx`;
}

function collectDateFormats(table: ExcelTable): Map<string, { styleIndex: number; numFmtId: number }> {
  const formats = new Map<string, { styleIndex: number; numFmtId: number }>();
  let nextStyle = 4;
  table.rows.flatMap((row) => table.headers.map((header) => row[header] ?? "")).forEach((value) => {
    if (isExcelValue(value) && (value.kind === "date" || value.kind === "datetime")) {
      const format = value.format ?? (value.kind === "date" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss");
      if (!formats.has(format)) formats.set(format, { styleIndex: nextStyle++, numFmtId: 164 + formats.size });
    }
  });
  return formats;
}

function worksheetXml(table: ExcelTable, formatStyles: Map<string, { styleIndex: number; numFmtId: number }>): string {
  const rows = [table.headers, ...table.rows.map((row) => table.headers.map((header) => row[header] ?? ""))];
  const cells = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const excelValue = rowIndex > 0 ? value : String(value);
    const key = isExcelValue(excelValue) && (excelValue.kind === "date" || excelValue.kind === "datetime") ? excelValue.format ?? (excelValue.kind === "date" ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm:ss") : "";
    const style = key ? formatStyles.get(key)?.styleIndex : rowIndex > 0 && value === true ? 2 : rowIndex > 0 && value === false ? 3 : 0;
    return cellXml(excelValue, cellReference(columnIndex, rowIndex), style ?? 0);
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`;
}

function cellXml(value: ExcelCell, reference: string, styleIndex: number): string {
  const style = styleIndex > 0 ? ` s="${styleIndex}"` : "";
  if (isExcelValue(value)) {
    if (value.kind === "blank") return `<c r="${reference}"/>`;
    if (value.kind === "date" || value.kind === "datetime") return `<c r="${reference}"${style} t="n"><v>${dateToExcelSerial(value.value)}</v></c>`;
    value = value.value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${style} t="n"><v>${value}</v></c>`;
  const displayValue = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value ?? "");
  return `<c r="${reference}"${style} t="inlineStr"><is><t>${escapeXml(displayValue)}</t></is></c>`;
}

function isExcelValue(value: ExcelCell): value is ExcelValue {
  return Boolean(value && typeof value === "object" && "kind" in value && "value" in value);
}

function dateToExcelSerial(value: Date): number {
  const milliseconds = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds());
  const epoch = Date.UTC(1899, 11, 31);
  const serial = (milliseconds - epoch) / 86_400_000;
  return serial >= 60 ? serial + 1 : serial;
}

function cellReference(columnIndex: number, rowIndex: number): string {
  let column = columnIndex + 1;
  let letters = "";
  while (column > 0) {
    const remainder = (column - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    column = Math.floor((column - 1) / 26);
  }
  return `${letters}${rowIndex + 1}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

function relationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31) || "Comparison")}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function stylesXml(formatStyles: Map<string, { styleIndex: number; numFmtId: number }>): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${formatStyles.size}">${[...formatStyles.entries()].map(([format, style]) => `<numFmt numFmtId="${style.numFmtId}" formatCode="${escapeXml(format)}"/>`).join("")}</numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${4 + formatStyles.size}"><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" applyFill="1"/>${[...formatStyles.values()].map((style) => `<xf numFmtId="${style.numFmtId}" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`).join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
