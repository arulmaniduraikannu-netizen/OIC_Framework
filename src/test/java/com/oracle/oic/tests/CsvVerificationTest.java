package com.oracle.oic.tests;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.testng.annotations.Test;

import com.oracle.oic.utils.CsvZipReader;
import com.oracle.oic.utils.ExcelVerificationReportWriter;

public class CsvVerificationTest {

    @Test
    public void readsStandaloneCsvWithQuotedValues() throws Exception {
        Path csv = Files.createTempFile("reference", ".csv");
        try {
            Files.writeString(csv, "transaction number,description\n"
                    + "2220431-R0,\"Item, original\"\n"
                    + "2220431-C0,Item modified\n");

            List<Map<String, String>> records = CsvZipReader.readCsvFile(csv);

            assertEquals(records.size(), 2);
            assertEquals(records.get(0).get("transaction number"), "2220431-R0");
            assertEquals(records.get(0).get("description"), "Item, original");
        } finally {
            Files.deleteIfExists(csv);
        }
    }

    @Test
    public void writesTrueFalseAndHighlightsFailedValueAndResult() throws Exception {
        Path report = Files.createTempDirectory("verification").resolve("report.xlsx");
        try {
            List<ExcelVerificationReportWriter.Verification> verifications = List.of(
                    new ExcelVerificationReportWriter.Verification(
                            "reference.csv", "2220431-R0", "field", "expected", "actual", false));

            ExcelVerificationReportWriter.write(verifications, report);

            try (XSSFWorkbook workbook = new XSSFWorkbook(Files.newInputStream(report))) {
                var row = workbook.getSheet("Verification").getRow(1);
                assertEquals(row.getCell(5).getStringCellValue(), "FALSE");
                assertEquals(row.getCell(4).getCellStyle().getFillPattern(), FillPatternType.SOLID_FOREGROUND);
                assertEquals(row.getCell(5).getCellStyle().getFillPattern(), FillPatternType.SOLID_FOREGROUND);
                assertTrue(row.getCell(2).getCellStyle().getFillPattern() != FillPatternType.SOLID_FOREGROUND);
            }
        } finally {
            Files.deleteIfExists(report);
        }
    }
}