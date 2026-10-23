package com.oracle.oic.utils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/** Writes the isolated Silvus source data and comparison result workbook. */
public final class SilvusComparisonReportWriter {

    private SilvusComparisonReportWriter() {
        throw new IllegalStateException("Utility class");
    }

    public static Path write(List<SourceRow> manageEarnings, List<SourceRow> otbiRows,
            Path report) throws IOException {
        return write(manageEarnings, otbiRows, manageEarnings, otbiRows, report);
        }

        public static Path write(List<SourceRow> manageEarnings, List<SourceRow> otbiRows,
            List<SourceRow> comparisonManageEarnings, List<SourceRow> comparisonOtbiRows,
            Path report) throws IOException {
        Files.createDirectories(report.getParent());
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            CellStyle green = fill(workbook, IndexedColors.LIGHT_GREEN);
            CellStyle red = fill(workbook, IndexedColors.ROSE);
            CellStyle header = headerStyle(workbook);
            CellStyle body = bodyStyle(workbook);
            writeSourceSheet(workbook.createSheet("Manage Earnings"), manageEarnings, header, body);
            writeSourceSheet(workbook.createSheet("OTBI Report"), otbiRows, header, body);
                writeComparisonSheet(workbook.createSheet("Comparison"), comparisonManageEarnings,
                    comparisonOtbiRows, header, green, red);
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                workbook.write(output);
                Files.write(report, output.toByteArray());
            }
        }
        return report;
    }

    private static void writeSourceSheet(Sheet sheet, List<SourceRow> rows, CellStyle header,
            CellStyle body) {
        String[] headers = { "Period", "Business Unit Name", "Participant", "Plan",
                "Plan Component Name", "Earning Amount", "Home Currency Code",
                "Home Currency Conversion Rate", "Earning Amount In Home Currency" };
        writeHeader(sheet.createRow(0), headers);
        for (int index = 0; index < headers.length; index++) {
            sheet.getRow(0).getCell(index).setCellStyle(header);
        }
        for (int index = 0; index < rows.size(); index++) {
            writeRow(sheet.createRow(index + 1), rows.get(index), body);
        }
        mergeGroups(sheet, rows, 0);
        mergeGroups(sheet, rows, 1);
        autoSize(sheet, headers.length);
    }

    private static void writeComparisonSheet(Sheet sheet, List<SourceRow> manageEarnings,
            List<SourceRow> otbiRows, CellStyle header, CellStyle green, CellStyle red) {
        String[] headers = { "Period", "Business Unit Name", "Participant", "Plan",
                "Plan Component Name", "Manage Earning Amount", "OTBI Earning Amount",
                "Manage Home Currency Code", "OTBI Home Currency Code",
                "Manage Conversion Rate", "OTBI Conversion Rate", "Manage Home Amount",
                "OTBI Home Amount", "Manage Process Status", "OTBI Process Status",
                "Comparison Result" };
        writeHeader(sheet.createRow(0), headers);
        for (int index = 0; index < headers.length; index++) {
            sheet.getRow(0).getCell(index).setCellStyle(header);
        }
        Map<String, SourceRow> manage = keyed(manageEarnings);
        Map<String, SourceRow> otbi = keyed(otbiRows);
        Set<String> keys = new LinkedHashSet<>(manage.keySet());
        keys.addAll(otbi.keySet());
        int rowIndex = 1;
        int matches = 0;
        for (String key : keys) {
            SourceRow left = manage.get(key);
            SourceRow right = otbi.get(key);
            boolean matchesRow = left != null && right != null && left.matches(right);
            Row row = sheet.createRow(rowIndex++);
            row.createCell(0).setCellValue(value(left, right, SourceRow::month));
            row.createCell(1).setCellValue(value(left, right, SourceRow::businessUnit));
            row.createCell(2).setCellValue(value(left, right, SourceRow::participant));
            row.createCell(3).setCellValue(value(left, right, SourceRow::plan));
            row.createCell(4).setCellValue(value(left, right, SourceRow::planComponent));
            row.createCell(5).setCellValue(left == null ? "" : left.earningAmount());
            row.createCell(6).setCellValue(right == null ? "" : right.earningAmount());
            row.createCell(7).setCellValue(left == null ? "" : left.homeCurrencyCode());
            row.createCell(8).setCellValue(right == null ? "" : right.homeCurrencyCode());
            row.createCell(9).setCellValue(left == null ? "" : left.homeCurrencyConversionRate());
            row.createCell(10).setCellValue(right == null ? "" : right.homeCurrencyConversionRate());
            row.createCell(11).setCellValue(left == null ? "" : left.earningAmountInHomeCurrency());
            row.createCell(12).setCellValue(right == null ? "" : right.earningAmountInHomeCurrency());
            row.createCell(13).setCellValue(left == null ? "" : left.processStatus());
            row.createCell(14).setCellValue(right == null ? "" : right.processStatus());
            String result = left == null ? "MISSING_IN_MANAGE" : right == null ? "MISSING_IN_OTBI"
                    : matchesRow ? "TRUE" : "FALSE";
            row.createCell(15).setCellValue(result);
            row.getCell(15).setCellStyle(matchesRow ? green : red);
            if (matchesRow) {
                matches++;
            }
        }
        Row summary = sheet.createRow(rowIndex + 1);
        summary.createCell(0).setCellValue("Total rows");
        summary.createCell(1).setCellValue(keys.size());
        summary.createCell(2).setCellValue("Matched");
        summary.createCell(3).setCellValue(matches);
        summary.createCell(4).setCellValue("Mismatched");
        summary.createCell(5).setCellValue(keys.size() - matches);
        autoSize(sheet, headers.length);
    }

    private static Map<String, SourceRow> keyed(List<SourceRow> rows) {
        Map<String, SourceRow> values = new LinkedHashMap<>();
        for (SourceRow row : rows) {
            values.put(row.key(), row);
        }
        return values;
    }

    private static String value(SourceRow left, SourceRow right,
            java.util.function.Function<SourceRow, String> field) {
        return left != null ? field.apply(left) : right == null ? "" : field.apply(right);
    }

    private static void writeHeader(Row row, String[] headers) {
        for (int index = 0; index < headers.length; index++) {
            row.createCell(index).setCellValue(headers[index]);
        }
    }

    private static void writeRow(Row row, SourceRow source, CellStyle body) {
        String[] values = { source.month(), source.businessUnit(), source.participant(), source.plan(),
                source.planComponent(), source.earningAmount(), source.homeCurrencyCode(),
                source.homeCurrencyConversionRate(), source.earningAmountInHomeCurrency() };
        for (int index = 0; index < values.length; index++) {
            row.createCell(index).setCellValue(values[index]);
            row.getCell(index).setCellStyle(body);
        }
    }

    private static void mergeGroups(Sheet sheet, List<SourceRow> rows, int column) {
        int start = 0;
        while (start < rows.size()) {
            String value = column == 0 ? rows.get(start).month() : rows.get(start).businessUnit();
            int end = start;
            while (end + 1 < rows.size() && value.equals(column == 0
                    ? rows.get(end + 1).month() : rows.get(end + 1).businessUnit())) {
                end++;
            }
            if (!value.isBlank() && end > start) {
                sheet.addMergedRegion(new CellRangeAddress(start + 1, end + 1, column, column));
            }
            start = end + 1;
        }
    }

    private static void autoSize(Sheet sheet, int columnCount) {
        for (int index = 0; index < columnCount; index++) {
            sheet.autoSizeColumn(index);
        }
    }

    private static CellStyle fill(XSSFWorkbook workbook, IndexedColors color) {
        CellStyle style = workbook.createCellStyle();
        style.setFillForegroundColor(color.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        return style;
    }

    private static CellStyle headerStyle(XSSFWorkbook workbook) {
        CellStyle style = workbook.createCellStyle();
        XSSFFont font = workbook.createFont();
        font.setBold(true);
        style.setFont(font);
        style.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setWrapText(true);
        style.setBorderBottom(BorderStyle.THIN);
        return style;
    }

    private static CellStyle bodyStyle(XSSFWorkbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        return style;
    }

    public record SourceRow(String month, String businessUnit, String participant, String plan,
            String planComponent, String earningAmount, String homeCurrencyCode,
            String homeCurrencyConversionRate, String earningAmountInHomeCurrency,
            String processStatus) {
        public String key() {
            return String.join("\u0000", month, businessUnit, participant, plan, planComponent);
        }

        public boolean matches(SourceRow other) {
            return ValueNormalizer.normalizeAmount(earningAmount)
                    .equals(ValueNormalizer.normalizeAmount(other.earningAmount))
                    && ValueNormalizer.normalizeText(homeCurrencyCode)
                    .equalsIgnoreCase(ValueNormalizer.normalizeText(other.homeCurrencyCode))
                    && ValueNormalizer.normalizeAmount(homeCurrencyConversionRate)
                    .equals(ValueNormalizer.normalizeAmount(other.homeCurrencyConversionRate))
                    && ValueNormalizer.normalizeAmount(earningAmountInHomeCurrency)
                    .equals(ValueNormalizer.normalizeAmount(other.earningAmountInHomeCurrency))
                    && (processStatus.isBlank() || other.processStatus.isBlank()
                            || ValueNormalizer.normalizeText(processStatus)
                                    .equalsIgnoreCase(ValueNormalizer.normalizeText(other.processStatus)));
        }
    }
}