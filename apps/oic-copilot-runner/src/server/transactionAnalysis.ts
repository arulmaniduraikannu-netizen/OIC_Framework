export interface TransactionDiagnostic {
  fileName: string;
  rowNumber: number;
  message: string;
  rawAmount: string;
}

export interface CurrencyTotal {
  currency: string;
  amountSum: string;
}

export interface TransactionFileResult {
  fileName: string;
  rowCount: number;
  transactionNumberCount: number;
  amountSum: string;
  currencyTotals: CurrencyTotal[];
  diagnostics: TransactionDiagnostic[];
  warnings: string[];
}

export interface TransactionBatchInput {
  fileName: string;
  content: string;
}

export interface TransactionRowsInput {
  fileName: string;
  rows: string[][];
}

export interface TransactionBatchResult {
  fileCount: number;
  rowCount: number;
  transactionNumberCount: number;
  amountSum: string;
  files: TransactionFileResult[];
  diagnostics: TransactionDiagnostic[];
  warnings: string[];
}

const TRANSACTION_NUMBER_HEADER = "transaction number";
const TRANSACTION_AMOUNT_HEADER = "transaction amount (source currency)";
const SOURCE_CURRENCY_HEADER = "source currency code";

export function analyzeCsvContent(content: string, fileName: string): TransactionFileResult {
  return analyzeTransactionRows(parseCsvContent(content), fileName);
}

export function analyzeTransactionRows(rows: string[][], fileName: string): TransactionFileResult {
  if (rows.length === 0) {
    throw new Error(`${fileName}: CSV is empty.`);
  }

  const headers = rows[0].map(normalizeHeader);
  const transactionNumberIndex = requiredColumn(headers, TRANSACTION_NUMBER_HEADER, fileName);
  const transactionAmountIndex = requiredColumn(headers, TRANSACTION_AMOUNT_HEADER, fileName);
  const sourceCurrencyIndex = headers.indexOf(SOURCE_CURRENCY_HEADER);
  const diagnostics: TransactionDiagnostic[] = [];
  const currencyAccumulators = new Map<string, DecimalAccumulator>();
  const totalAccumulator = new DecimalAccumulator();
  let transactionNumberCount = 0;

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const transactionNumber = row[transactionNumberIndex]?.trim() ?? "";
    const rawAmount = row[transactionAmountIndex]?.trim() ?? "";
    const currency = (sourceCurrencyIndex >= 0 ? row[sourceCurrencyIndex]?.trim() : "") || "UNSPECIFIED";

    if (transactionNumber) {
      transactionNumberCount += 1;
    }

    if (!rawAmount) {
      diagnostics.push({ fileName, rowNumber, message: "Transaction amount is blank.", rawAmount });
      return;
    }

    let amount: DecimalValue;
    try {
      amount = parseDecimal(rawAmount);
    } catch {
      diagnostics.push({ fileName, rowNumber, message: "Transaction amount is not a valid decimal.", rawAmount });
      return;
    }

    totalAccumulator.add(amount);
    const currencyAccumulator = currencyAccumulators.get(currency) ?? new DecimalAccumulator();
    currencyAccumulator.add(amount);
    currencyAccumulators.set(currency, currencyAccumulator);
  });

  const currencyTotals = [...currencyAccumulators.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, accumulator]) => ({ currency, amountSum: accumulator.toString() }));
  const warnings = currencyTotals.length > 1
    ? ["Multiple source currencies are present; amountSum is a raw column total and must not be treated as a converted total."]
    : [];

  return {
    fileName,
    rowCount: Math.max(rows.length - 1, 0),
    transactionNumberCount,
    amountSum: totalAccumulator.toString(),
    currencyTotals,
    diagnostics,
    warnings
  };
}

export function analyzeCsvBatch(inputs: TransactionBatchInput[]): TransactionBatchResult {
  return analyzeTransactionBatch(inputs.map((input) => ({ fileName: input.fileName, rows: parseCsvContent(input.content) })));
}

export const MAX_TRANSACTION_FILES = 20;

export function analyzeTransactionBatch(inputs: TransactionRowsInput[]): TransactionBatchResult {
  if (inputs.length === 0) {
    throw new Error("At least one transaction data file is required.");
  }
  if (inputs.length > MAX_TRANSACTION_FILES) {
    throw new Error(`A batch may contain at most ${MAX_TRANSACTION_FILES} CSV files.`);
  }

  const files = inputs.map((input) => analyzeTransactionRows(input.rows, input.fileName));
  const totalAccumulator = new DecimalAccumulator();
  files.forEach((file) => totalAccumulator.add(parseDecimal(file.amountSum)));
  const diagnostics = files.flatMap((file) => file.diagnostics);
  const warnings = [...new Set(files.flatMap((file) => file.warnings))];

  return {
    fileCount: files.length,
    rowCount: files.reduce((total, file) => total + file.rowCount, 0),
    transactionNumberCount: files.reduce((total, file) => total + file.transactionNumberCount, 0),
    amountSum: totalAccumulator.toString(),
    files,
    diagnostics,
    warnings
  };
}

function requiredColumn(headers: string[], header: string, fileName: string): number {
  const index = headers.indexOf(header);
  if (index < 0) {
    throw new Error(`${fileName}: required column "${header}" was not found.`);
  }
  return index;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseCsvContent(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (quoted && nextCharacter && nextCharacter !== "," && nextCharacter !== "\n" && nextCharacter !== "\r") {
        field += character;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim())) {
      rows.push(row);
    }
  }

  if (quoted) {
    throw new Error("CSV contains an unterminated quoted field.");
  }
  return rows;
}

interface DecimalValue {
  unscaled: bigint;
  scale: number;
}

function parseDecimal(value: string): DecimalValue {
  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const fraction = match[3] ?? "";
  const sign = match[1] === "-" ? -1n : 1n;
  return { unscaled: sign * BigInt(`${match[2]}${fraction}`), scale: fraction.length };
}

class DecimalAccumulator {
  private unscaled = 0n;
  private scale = 0;

  add(value: DecimalValue): void {
    if (value.scale > this.scale) {
      this.unscaled *= 10n ** BigInt(value.scale - this.scale);
      this.scale = value.scale;
    }
    this.unscaled += value.unscaled * 10n ** BigInt(this.scale - value.scale);
  }

  toString(): string {
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString().padStart(this.scale + 1, "0");
    if (this.scale === 0) {
      return `${negative ? "-" : ""}${digits}`;
    }
    const splitAt = digits.length - this.scale;
    const integerPart = digits.slice(0, splitAt) || "0";
    const fractionPart = digits.slice(splitAt).replace(/0+$/, "");
    return `${negative ? "-" : ""}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
  }
}