import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { TransactionBatchResult } from "./transactionAnalysis.js";
import type { ExcelAnalysisResult } from "../shared/types.js";

export function createRunnerTools() {
  return [
    defineTool("oracle_docs_search", {
      description: "Search Oracle documentation and return concise official result snippets.",
      parameters: z.object({
        query: z.string().describe("Search query for Oracle Cloud/Fusion documentation."),
        top: z.number().min(1).max(10).optional().describe("Maximum number of results to return.")
      }),
      skipPermission: true,
      defer: "never",
      handler: async ({ query, top = 5 }) => searchOracleDocs(query, top)
    })
  ];
}

export function createTransactionAnalysisTool(result: TransactionBatchResult) {
  return defineTool("transaction_analysis_result", {
    description: "Return the deterministic transaction count, amount totals, diagnostics, and currency warnings for the uploaded files. Do not recalculate or alter these values.",
    parameters: z.object({}),
    skipPermission: true,
    defer: "never",
    handler: async () => result
  });
}

export function createExcelAnalysisTool(result: ExcelAnalysisResult) {
  return defineTool("excel_analysis_result", {
    description: "Return deterministic Excel tables, operation facts, and diagnostics. Do not recalculate or alter these values.",
    parameters: z.object({}),
    skipPermission: true,
    defer: "never",
    handler: async () => result
  });
}

async function searchOracleDocs(query: string, top: number) {
  const url = new URL("https://docs.oracle.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("group", "EN");
  url.searchParams.set("limit", String(top));
  const response = await fetch(url, {
    headers: { Accept: "text/html" }
  });
  if (!response.ok) {
    throw new Error(`Oracle docs search failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  // The docs.oracle.com search page renders results client-side; the request still
  // succeeds, so surface a link instead of pretending we parsed results.
  return [{
    title: "Oracle Cloud documentation search",
    url: `https://docs.oracle.com/search?q=${encodeURIComponent(query)}`,
    excerpt: "Search results load client-side. Open the link to see official Oracle Cloud / Fusion Applications documentation."
  }];
}
