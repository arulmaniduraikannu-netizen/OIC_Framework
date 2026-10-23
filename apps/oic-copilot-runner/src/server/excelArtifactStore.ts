import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "./config.js";
import type { ExcelArtifact } from "../shared/types.js";
import JSZip from "jszip";

const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;
const ARTIFACT_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const ARTIFACT_EXTENSIONS = new Set([".csv", ".xlsx"]);
const MIME_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

export async function persistExcelArtifacts(stagingDirectory: string, stagedInputPaths: string[], options: { comparisonOnly?: boolean } = {}): Promise<ExcelArtifact[]> {
  await fs.mkdir(paths.excelArtifactsPath, { recursive: true });
  await removeExpiredExcelArtifacts();
  const inputPaths = new Set(stagedInputPaths.map((filePath) => path.resolve(filePath)));
  const generatedPaths = await findExcelFiles(stagingDirectory);
  const artifacts: ExcelArtifact[] = [];

  for (const generatedPath of generatedPaths) {
    if (inputPaths.has(path.resolve(generatedPath))) continue;
    if (options.comparisonOnly && path.extname(generatedPath).toLowerCase() === ".xlsx") {
      await keepComparisonWorksheet(generatedPath);
    }
    const extension = path.extname(generatedPath).toLowerCase();
    const id = crypto.randomUUID();
    const safeName = path.basename(generatedPath).replace(/[^a-z0-9._-]/gi, "_") || `excel-output${extension}`;
    await fs.copyFile(generatedPath, path.join(paths.excelArtifactsPath, `${id}-${safeName}`));
    artifacts.push({
      id,
      fileName: path.basename(generatedPath),
      mimeType: MIME_TYPES[extension],
      downloadUrl: `/api/excel-analysis/artifacts/${id}`
    });
  }
  return artifacts;
}

export async function resolveExcelArtifact(id: string): Promise<{ filePath: string; fileName: string; mimeType: string } | undefined> {
  if (!ARTIFACT_ID_PATTERN.test(id)) return undefined;
  const entries = await fs.readdir(paths.excelArtifactsPath, { withFileTypes: true }).catch(() => []);
  const entry = entries.find((candidate) => candidate.isFile() && candidate.name.startsWith(`${id}-`) && ARTIFACT_EXTENSIONS.has(path.extname(candidate.name).toLowerCase()));
  if (entry) {
    const filePath = path.join(paths.excelArtifactsPath, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    return { filePath, fileName: entry.name.slice(id.length + 1), mimeType: MIME_TYPES[extension] };
  }
  return undefined;
}

async function findExcelFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findExcelFiles(entryPath));
    } else if (entry.isFile() && ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }
  return files;
}

async function removeExpiredExcelArtifacts(): Promise<void> {
  const entries = await fs.readdir(paths.excelArtifactsPath, { withFileTypes: true });
  const cutoff = Date.now() - ARTIFACT_TTL_MS;
  await Promise.all(entries
    .filter((entry) => entry.isFile() && ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(async (entry) => {
      const filePath = path.join(paths.excelArtifactsPath, entry.name);
      if ((await fs.stat(filePath)).mtimeMs < cutoff) await fs.rm(filePath, { force: true });
    }));
}

async function keepComparisonWorksheet(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath);
  if (content.length < 4 || content[0] !== 0x50 || content[1] !== 0x4b) {
    throw new Error(`Invalid Excel MCP artifact: ${path.basename(filePath)} is not a valid XLSX ZIP package.`);
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(content);
  } catch {
    throw new Error(`Invalid Excel MCP artifact: ${path.basename(filePath)} could not be opened as an XLSX package.`);
  }
  const workbookEntry = zip.file("xl/workbook.xml");
  const relationshipsEntry = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) return;
  const workbookXml = await workbookEntry.async("string");
  const relationshipsXml = await relationshipsEntry.async("string");
  const sheetMatches = [...workbookXml.matchAll(/<sheet\b[^>]*?\/>/g)];
  if (sheetMatches.length <= 1) return;
  const relationshipTargets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*?\/>/g)) {
    const id = match[0].match(/\bId="([^"]+)"/)?.[1];
    const target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relationshipTargets.set(id, target);
  }
  const preferred = sheetMatches.find((match) => /\bname="[^"]*(?:comparison|result|match)[^"]*"/i.test(match[0])) ?? sheetMatches.at(-1)!;
  const preferredId = preferred[0].match(/\br:id="([^"]+)"/)?.[1];
  const preferredTarget = preferredId ? relationshipTargets.get(preferredId) : undefined;
  if (!preferredTarget) return;
  const preferredWorksheetPath = `xl/${preferredTarget}`;
  const preferredWorksheet = zip.file(preferredWorksheetPath);
  if (preferredWorksheet) {
    const worksheetXml = await preferredWorksheet.async("string");
    zip.file(preferredWorksheetPath, worksheetXml.replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g, ""));
  }
  zip.file("xl/workbook.xml", workbookXml.replace(/<sheet\b[^>]*?\/>/g, (sheet) => sheet === preferred[0] ? sheet : ""));
  const worksheetTargets = new Set<string>();
  for (const sheet of sheetMatches) {
    if (sheet[0] === preferred[0]) continue;
    const id = sheet[0].match(/\br:id="([^"]+)"/)?.[1];
    const target = id ? relationshipTargets.get(id) : undefined;
    if (target?.startsWith("worksheets/")) worksheetTargets.add(`xl/${target}`);
  }
  zip.file("xl/_rels/workbook.xml.rels", relationshipsXml.replace(/<Relationship\b[^>]*?\/>/g, (relationship) => {
    const id = relationship.match(/\bId="([^"]+)"/)?.[1];
    return id && id !== preferredId && relationshipTargets.get(id)?.startsWith("worksheets/") ? "" : relationship;
  }));
  for (const target of worksheetTargets) zip.remove(target);
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) {
    const contentTypesXml = await contentTypes.async("string");
    zip.file("[Content_Types].xml", contentTypesXml.replace(/<Override\b[^>]*PartName="\/xl\/worksheets\/[^\"]+"[^>]*\/>/g, (override) => {
      return override.includes(`/xl/${preferredTarget}`) ? override : "";
    }));
  }
  await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
}