package com.oracle.oic.utils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/** Writes every row captured from the Silvus revenue-versus-quota report. */
public final class SilvusRevenueQuotaReportWriter {

    private SilvusRevenueQuotaReportWriter() {
        throw new IllegalStateException("Utility class");
    }

    public static Path write(List<List<String>> tableRows, Path report) throws IOException {
        Files.createDirectories(report.getParent());
        try (XSSFWorkbook workbook = new XSSFWorkbook()) {
            CellStyle header = headerStyle(workbook);
            CellStyle body = bodyStyle(workbook);
            Sheet sheet = workbook.createSheet("Revenue vs Quota");
            for (int rowIndex = 0; rowIndex < tableRows.size(); rowIndex++) {
                Row row = sheet.createRow(rowIndex);
                List<String> values = tableRows.get(rowIndex);
                for (int column = 0; column < values.size(); column++) {
                    row.createCell(column).setCellValue(values.get(column));
                    row.getCell(column).setCellStyle(rowIndex == 0 ? header : body);
                }
            }
            autoSize(sheet, tableRows.stream().mapToInt(List::size).max().orElse(0));
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                workbook.write(output);
                Files.write(report, output.toByteArray());
            }
        }
        return report;
    }

    private static void autoSize(Sheet sheet, int columnCount) {
        for (int column = 0; column < columnCount; column++) {
            sheet.autoSizeColumn(column);
        }
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
}