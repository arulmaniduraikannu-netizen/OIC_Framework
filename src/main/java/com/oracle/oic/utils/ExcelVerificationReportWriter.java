package com.oracle.oic.utils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.oracle.oic.pages.TransactionsPage.TransactionDetail;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/** Writes comparison results to an Excel report with match/failure colors. */
public final class ExcelVerificationReportWriter {

    private ExcelVerificationReportWriter() {
        throw new IllegalStateException("Utility class");
    }

    public static Path write(List<Verification> verifications, Path report) throws IOException {
        return write(Map.of(), verifications, report);
    }

    public static Path write(Map<String, List<Map<String, String>>> recordsByFile,
            List<Verification> verifications, Path report) throws IOException {
        if (Files.exists(report)) {
            report = report.resolveSibling("UCM_EDH_Verification_" + System.currentTimeMillis() + ".xlsx");
        }
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Verification");
            writeInterleavedRecords(sheet, recordsByFile, verifications, workbook);
            for (int index = 0; index < sheet.getRow(0).getLastCellNum(); index++) {
                sheet.autoSizeColumn(index);
            }
            Files.createDirectories(report.getParent());
            Files.write(report, workbookToBytes(workbook));
        }
        return report;
    }

    private static void writeInterleavedRecords(Sheet sheet,
            Map<String, List<Map<String, String>>> recordsByFile,
            List<Verification> verifications, XSSFWorkbook workbook) {
        Set<String> columns = new LinkedHashSet<>();
        for (List<Map<String, String>> records : recordsByFile.values()) {
            for (Map<String, String> record : records) {
                columns.addAll(record.keySet());
            }
        }
        Row header = sheet.createRow(0);
        int columnIndex = 0;
        for (String column : columns) {
            header.createCell(columnIndex++).setCellValue(column);
        }
        CellStyle green = fill(workbook, IndexedColors.LIGHT_GREEN);
        CellStyle red = fill(workbook, IndexedColors.ROSE);
        Map<String, Verification> verificationByField = new LinkedHashMap<>();
        for (Verification verification : verifications) {
            verificationByField.put(key(verification.fileName(), verification.transaction(),
                    verification.field()), verification);
        }
        int rowIndex = 1;
        for (Map.Entry<String, List<Map<String, String>>> file : recordsByFile.entrySet()) {
            Map<String, Map<String, Map<String, String>>> pairs = new LinkedHashMap<>();
            for (Map<String, String> record : file.getValue()) {
                String transaction = record.getOrDefault("transaction number", "");
                if (transaction.endsWith("-R0")) {
                    pairs.computeIfAbsent(transaction.substring(0, transaction.length() - 3),
                            ignored -> new LinkedHashMap<>()).put("R0", record);
                } else if (transaction.endsWith("-C0")) {
                    pairs.computeIfAbsent(transaction.substring(0, transaction.length() - 3),
                            ignored -> new LinkedHashMap<>()).put("C0", record);
                }
            }
            for (Map.Entry<String, Map<String, Map<String, String>>> pair : pairs.entrySet()) {
                Map<String, String> r0 = pair.getValue().get("R0");
                Map<String, String> c0 = pair.getValue().get("C0");
                if (r0 == null || c0 == null) {
                    continue;
                }
                writeRecordRow(sheet.createRow(rowIndex++), columns, r0);
                Row resultRow = sheet.createRow(rowIndex++);
                writeComparisonRow(resultRow, columns, file.getKey(), pair.getKey(),
                        r0, c0, verificationByField, green, red);
                writeRecordRow(sheet.createRow(rowIndex++), columns, c0);
            }
        }
    }

    private static void writeRecordRow(Row row, Set<String> columns, Map<String, String> record) {
        int columnIndex = 0;
        for (String column : columns) {
            row.createCell(columnIndex++).setCellValue(record.getOrDefault(column, ""));
        }
    }

    private static void writeComparisonRow(Row row, Set<String> columns, String fileName,
            String transaction, Map<String, String> r0, Map<String, String> c0,
            Map<String, Verification> verificationByField, CellStyle green, CellStyle red) {
        int columnIndex = 0;
        for (String column : columns) {
            Verification verification = verificationByField.get(key(fileName, transaction, column));
            boolean matches = verification != null
                    ? verification.matches()
                    : r0.getOrDefault(column, "").equals(c0.getOrDefault(column, ""));
            var cell = row.createCell(columnIndex++);
            cell.setCellValue(matches ? "TRUE" : "FALSE");
            cell.setCellStyle(matches ? green : red);
        }
    }

    private static String key(String fileName, String transaction, String field) {
        return fileName + "\u0000" + transaction + "\u0000" + field;
    }

    public static Path writeTransactionDetails(List<TransactionDetail> details, Path report)
            throws IOException {
        report = report.resolveSibling(transactionReportFileName(details));
        if (Files.exists(report)) {
            report = report.resolveSibling("Transaction_Details_" + System.currentTimeMillis() + ".xlsx");
        }
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("Transaction Details");
            Map<String, Map<String, Map<String, String>>> pairsByTransaction = new LinkedHashMap<>();
            Set<String> columns = new LinkedHashSet<>();
            columns.add("Transaction Number");
            for (TransactionDetail detail : details) {
            String transaction = detail.transactionNumber();
            String suffix = transaction.endsWith("-R0") ? "R0"
                : transaction.endsWith("-C0") ? "C0" : "BASE";
            String baseTransaction = transaction.endsWith("-R0") || transaction.endsWith("-C0")
                ? transaction.substring(0, transaction.length() - 3)
                : transaction;
            pairsByTransaction
                .computeIfAbsent(baseTransaction, ignored -> new LinkedHashMap<>())
                .computeIfAbsent(suffix, ignored -> new LinkedHashMap<>())
                .put(detail.field(), detail.value());
                columns.add(detail.field());
            }

            Row header = sheet.createRow(0);
            int columnIndex = 0;
            for (String column : columns) {
                header.createCell(columnIndex++).setCellValue(column);
            }

            CellStyle green = fill(workbook, IndexedColors.LIGHT_GREEN);
            CellStyle red = fill(workbook, IndexedColors.ROSE);
            int rowIndex = 1;
            for (Map.Entry<String, Map<String, Map<String, String>>> pair : pairsByTransaction.entrySet()) {
                Map<String, String> r0 = pair.getValue().get("R0");
                Map<String, String> c0 = pair.getValue().get("C0");
                if (r0 == null || c0 == null) {
                    continue;
                }
                writeTransactionRow(sheet.createRow(rowIndex++), columns,
                        pair.getKey() + "-R0", r0);
                writeTransactionComparisonRow(sheet.createRow(rowIndex++), columns,
                        r0, c0, green, red);
                writeTransactionRow(sheet.createRow(rowIndex++), columns,
                        pair.getKey() + "-C0", c0);
            }

            for (int index = 0; index < columns.size(); index++) {
                sheet.autoSizeColumn(index);
            }
            Files.createDirectories(report.getParent());
            Files.write(report, workbookToBytes(workbook));
        }
        return report;
    }

    private static String transactionReportFileName(List<TransactionDetail> details) {
        Set<String> transactionNumbers = new LinkedHashSet<>();
        for (TransactionDetail detail : details) {
            String transactionNumber = detail.transactionNumber();
            transactionNumbers.add(transactionNumber.replaceFirst("-[RC]0$", ""));
        }
        if (transactionNumbers.isEmpty()) {
            return "Transaction_Details.xlsx";
        }
        String suffix = String.join("_", transactionNumbers);
        return "Transaction_Details_" + suffix + ".xlsx";
    }

    private static void writeTransactionRow(Row row, Set<String> columns,
            String transactionNumber, Map<String, String> values) {
        int columnIndex = 0;
        for (String column : columns) {
            row.createCell(columnIndex++).setCellValue(column.equals("Transaction Number")
                    ? transactionNumber : values.getOrDefault(column, ""));
        }
    }

    private static void writeTransactionComparisonRow(Row row, Set<String> columns,
            Map<String, String> r0, Map<String, String> c0,
            CellStyle green, CellStyle red) {
        int columnIndex = 0;
        for (String column : columns) {
            boolean matches = r0.getOrDefault(column, "").equals(c0.getOrDefault(column, ""));
            var cell = row.createCell(columnIndex++);
            cell.setCellValue(matches ? "TRUE" : "FALSE");
            cell.setCellStyle(matches ? green : red);
        }
    }

    private static CellStyle fill(XSSFWorkbook workbook, IndexedColors color) {
        CellStyle style = workbook.createCellStyle();
        style.setFillForegroundColor(color.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        return style;
    }

    private static byte[] workbookToBytes(XSSFWorkbook workbook) throws IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        workbook.write(output);
        return output.toByteArray();
    }

    public record Verification(String fileName, String transaction, String field, String expectedValue,
            String actualValue, boolean matches) {
        @Override
        public String toString() {
            return transaction + " / " + field + " expected='" + expectedValue
                    + "' actual='" + actualValue + "'";
        }
    }
}