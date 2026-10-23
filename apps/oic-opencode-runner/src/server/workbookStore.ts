import fs from "node:fs/promises";
import path from "node:path";
import type { WorkbookDescriptor } from "../shared/types.js";
import { paths, settings } from "./config.js";

interface UploadWorkbookRequest {
  fileName: string;
  contentBase64: string;
}

export async function ensureWorkbookFolder(): Promise<void> {
  await fs.mkdir(paths.workbooksPath, { recursive: true });
}

export async function listWorkbooks(): Promise<WorkbookDescriptor[]> {
  await ensureWorkbookFolder();
  const files = await fs.readdir(paths.workbooksPath);
  const uploaded = await Promise.all(
    files
      .filter((file) => file.toLowerCase().endsWith(".xlsx"))
      .map(async (file) => {
        const filePath = path.join(paths.workbooksPath, file);
        const stat = await fs.stat(filePath);
        return {
          id: path.basename(file, ".xlsx"),
          name: file,
          path: filePath,
          source: "uploaded" as const,
          uploadedAt: stat.birthtime.toISOString()
        };
      })
  );

  return [getDefaultWorkbook(), ...uploaded.sort((left, right) => right.name.localeCompare(left.name))];
}

export async function getWorkbookById(id: string | undefined): Promise<WorkbookDescriptor> {
  const normalizedId = normalizeWorkbookId(id || "default") || "default";
  if (normalizedId === "default") {
    return getDefaultWorkbook();
  }

  const match = (await listWorkbooks()).find((workbook) => workbook.id === normalizedId);
  if (!match) {
    throw new Error(`Workbook not found: ${normalizedId}`);
  }
  return match;
}

export async function saveUploadedWorkbook(upload: UploadWorkbookRequest): Promise<WorkbookDescriptor> {
  await ensureWorkbookFolder();
  if (!upload.fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx workbooks are supported.");
  }

  const baseName = sanitizeWorkbookId(path.basename(upload.fileName, path.extname(upload.fileName)));
  const id = `${Date.now()}-${baseName}`;
  const fileName = `${id}.xlsx`;
  const filePath = path.join(paths.workbooksPath, fileName);
  await fs.writeFile(filePath, Buffer.from(upload.contentBase64, "base64"));

  return {
    id,
    name: upload.fileName,
    path: filePath,
    source: "uploaded",
    uploadedAt: new Date().toISOString()
  };
}

function getDefaultWorkbook(): WorkbookDescriptor {
  return {
    id: "default",
    name: path.basename(settings.workbookPath),
    path: settings.workbookPath,
    source: "default"
  };
}

function sanitizeWorkbookId(value: string): string {
  return normalizeWorkbookId(value).slice(0, 80) || "workbook";
}

function normalizeWorkbookId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
