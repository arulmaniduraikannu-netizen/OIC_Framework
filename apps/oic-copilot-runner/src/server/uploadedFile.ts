import fs from "node:fs/promises";

export interface UploadedFile {
  fileName: string;
  filePath: string;
  size: number;
}

export async function readUploadedFile(file: UploadedFile): Promise<Buffer> {
  return fs.readFile(file.filePath);
}