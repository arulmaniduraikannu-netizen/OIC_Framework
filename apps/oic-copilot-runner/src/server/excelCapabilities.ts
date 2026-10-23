import type { ExcelCapabilityContract, ExcelOperationCapability } from "../shared/types.js";
import { createDefaultExcelOperationRegistry, type ExcelOperationRegistry } from "./excelAnalysisRegistry.js";

export const EXCEL_XLSX_EXPORT_CAPABILITY: ExcelOperationCapability = {
  id: "exportXlsx",
  description: "Export a named deterministic result table to a downloadable XLSX workbook.",
  requiredInputs: ["tableName"],
  optionalInputs: ["fileName"],
  tableScope: "one",
  rowScope: "wholeTable",
  resultType: "artifact",
  createsArtifact: true,
  limitations: ["Exports XLSX only.", "The named table must already exist in the current runtime results."]
};

export function getExcelOperationCapabilities(registry: ExcelOperationRegistry = createDefaultExcelOperationRegistry()): ExcelOperationCapability[] {
  return [...registry.getCapabilities(), { ...EXCEL_XLSX_EXPORT_CAPABILITY, requiredInputs: [...EXCEL_XLSX_EXPORT_CAPABILITY.requiredInputs], optionalInputs: [...EXCEL_XLSX_EXPORT_CAPABILITY.optionalInputs], limitations: [...EXCEL_XLSX_EXPORT_CAPABILITY.limitations] }];
}

export function getExcelCapabilityContracts(): ExcelCapabilityContract[] {
  const registry = createDefaultExcelOperationRegistry();
  return [
    {
      id: "local-registry",
      description: "Deterministic operations over discovered workbook tables.",
      operationKinds: registry.getOperationKinds(),
      deterministic: true,
      readOnly: true,
      localVerification: "performed",
      clarificationRequired: true
    },
    {
      id: "excel-mcp",
      description: "Staged Excel MCP analysis, aggregation, writes, exports, and conversions for clear requests the local operation registry cannot represent.",
      deterministic: false,
      readOnly: true,
      localVerification: "not-performed",
      clarificationRequired: true
    }
  ];
}
