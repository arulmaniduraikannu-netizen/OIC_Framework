package com.oracle.oic.utils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;

/** Reads headerless Excel test rows from src/test/resources/testdata. */
public final class ExcelReader {

    private static final String TEST_DATA_DIRECTORY = "testdata/";

    private ExcelReader() {
        throw new IllegalStateException("Utility class");
    }

    /**
     * Returns each non-empty row as String values. The caller owns the column
     * mapping so a workbook can evolve without coupling this shared utility to
     * one Oracle workflow.
     */
    public static Object[][] readRows(String workbookName, String sheetName) {
        String resourcePath = TEST_DATA_DIRECTORY + workbookName;
        try (InputStream inputStream = ExcelReader.class.getClassLoader()
                .getResourceAsStream(resourcePath)) {
            if (inputStream == null) {
                throw new IllegalArgumentException("Test-data workbook not found: " + resourcePath);
            }
            try (Workbook workbook = WorkbookFactory.create(inputStream)) {
                Sheet sheet = workbook.getSheet(sheetName);
                if (sheet == null) {
                    throw new IllegalArgumentException("Worksheet not found: " + sheetName);
                }
                return toRows(sheet);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read workbook: " + resourcePath, exception);
        }
    }

    /** Returns the first non-blank cell text containing the supplied marker. */
    public static String findCellContaining(String workbookName, String sheetName, String marker) {
        for (Object[] row : readRows(workbookName, sheetName)) {
            for (Object value : row) {
                if (value != null && value.toString().contains(marker)) {
                    return value.toString();
                }
            }
        }
        throw new IllegalArgumentException(
                "No workbook cell contains marker: " + marker);
    }

    public static List<List<String>> readFirstSheet(Path workbookPath) {
        try (Workbook workbook = WorkbookFactory.create(workbookPath.toFile())) {
            Sheet sheet = workbook.getSheetAt(0);
            DataFormatter formatter = new DataFormatter();
            List<List<String>> rows = new ArrayList<>();
            for (Row row : sheet) {
                if (isBlank(row, formatter)) {
                    continue;
                }
                List<String> values = new ArrayList<>();
                for (int column = 0; column < row.getLastCellNum(); column++) {
                    values.add(formatter.formatCellValue(row.getCell(column)));
                }
                rows.add(values);
            }
            return rows;
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read workbook: " + workbookPath, exception);
        }
    }

    private static Object[][] toRows(Sheet sheet) {
        DataFormatter formatter = new DataFormatter();
        List<Object[]> rows = new ArrayList<>();
        for (Row row : sheet) {
            if (isBlank(row, formatter)) {
                continue;
            }
            Object[] values = new Object[Math.max(row.getLastCellNum(), 0)];
            for (int column = 0; column < values.length; column++) {
                values[column] = formatter.formatCellValue(row.getCell(column));
            }
            rows.add(values);
        }
        return rows.toArray(Object[][]::new);
    }

    private static boolean isBlank(Row row, DataFormatter formatter) {
        for (int column = row.getFirstCellNum(); column >= 0 && column < row.getLastCellNum(); column++) {
            if (!formatter.formatCellValue(row.getCell(column)).isBlank()) {
                return false;
            }
        }
        return true;
    }
}
