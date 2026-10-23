package com.oracle.oic.tests.support;

import java.util.ArrayList;
import java.util.List;

import com.oracle.oic.utils.ExcelReader;

public final class WorkbookScenarioReader {

    private WorkbookScenarioReader() {
        throw new IllegalStateException("Utility class");
    }

    public static String findCellContaining(String workbook, String sheet, String scenario,
            String marker) {
        for (Object[] row : scenarioRows(workbook, sheet, scenario)) {
            for (Object value : row) {
                if (value != null && value.toString().contains(marker)) {
                    return value.toString();
                }
            }
        }
        throw new IllegalArgumentException("No cell containing '" + marker
                + "' found in workbook scenario '" + scenario + "'.");
    }

    public static List<Object[]> scenarioRows(String workbook, String sheet, String scenario) {
        Object[][] rows = ExcelReader.readRows(workbook, sheet);
        List<Object[]> selectedRows = new ArrayList<>();
        boolean scenarioStarted = false;
        for (Object[] row : rows) {
            if (!scenarioStarted && contains(row, scenario)) {
                scenarioStarted = true;
            } else if (scenarioStarted && isScenarioHeader(row)) {
                break;
            }
            if (scenarioStarted) {
                selectedRows.add(row);
            }
        }
        if (selectedRows.isEmpty()) {
            throw new IllegalArgumentException("Workbook scenario not found: " + scenario);
        }
        return selectedRows;
    }

    private static boolean contains(Object[] row, String text) {
        for (Object value : row) {
            if (value != null && value.toString().contains(text)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isScenarioHeader(Object[] row) {
        Object firstValue = row.length == 0 ? null : row[0];
        return firstValue != null && firstValue.toString().trim().matches("\\d+\\..*");
    }
}