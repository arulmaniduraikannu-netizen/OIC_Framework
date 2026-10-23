import path from "node:path";
import JSZip from "jszip";
import { excelValueText, parseWorkbookTables } from "./excelParser.js";
import { MAX_TRANSACTION_FILES, parseCsvContent, type TransactionRowsInput } from "./transactionAnalysis.js";
import { readUploadedFile, type UploadedFile } from "./uploadedFile.js";

const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".zip"]);

export interface EncodedTransactionFile {
  fileName: string;
  contentBase64: string;
}

export async function adaptTransactionFiles(files: Array<EncodedTransactionFile | UploadedFile>): Promise<TransactionRowsInput[]> {
  if (files.length === 0) {
    throw new Error("At least one transaction data file is required.");
  }

  const adapted: TransactionRowsInput[] = [];
  for (const file of files) {
    const content = "filePath" in file ? await readUploadedFile(file) : Buffer.from(file.contentBase64, "base64");
    adapted.push(...await adaptTransactionFile(file.fileName, content));
    if (adapted.length > MAX_TRANSACTION_FILES) {
      throw new Error(`A batch may contain at most ${MAX_TRANSACTION_FILES} CSV/XLSX files after ZIP expansion.`);
    }
  }
  return adapted;
}

async function adaptTransactionFile(fileName: string, content: Uint8Array): Promise<TransactionRowsInput[]> {
  const extension = path.extname(fileName).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`${fileName}: only .csv, .xlsx, and .zip files are supported.`);
  }

  if (extension === ".csv") {
    return [{ fileName, rows: parseCsvContent(Buffer.from(content).toString("utf8")) }];
  }

  if (extension === ".xlsx") {
    const tables = await parseWorkbookTables(content);
    if (tables.length === 0) {
      throw new Error(`${fileName}: workbook contains no worksheets.`);
    }
    return tables.map((table) => ({
      fileName: tables.length === 1 ? fileName : `${fileName}#${table.name}`,
      rows: table.rows.map((row) => row.map(excelValueText))
    }));
  }

  const zip = await JSZip.loadAsync(content);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  if (entries.length === 0) {
    throw new Error(`${fileName}: ZIP contains no .csv or .xlsx files.`);
  }

  const nestedFiles: TransactionRowsInput[] = [];
  for (const entry of entries) {
    nestedFiles.push(...await adaptTransactionFile(`${fileName}#${path.basename(entry.name)}`, await entry.async("uint8array")));
  }
  return nestedFiles;
}
