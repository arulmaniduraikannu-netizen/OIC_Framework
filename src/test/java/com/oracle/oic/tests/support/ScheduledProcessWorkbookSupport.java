package com.oracle.oic.tests.support;

import java.util.Arrays;
import java.util.List;

/** Reads the process-name list from the existing scenario 14 workbook step. */
public final class ScheduledProcessWorkbookSupport {
    private static final String SCENARIO = "14.Monitoring the schedule Process by Process names";

    private ScheduledProcessWorkbookSupport() {
        throw new IllegalStateException("Utility class");
    }

    public static List<String> rootNames() {
        String step = WorkbookScenarioReader.findCellContaining(
                System.getProperty("oic.monitor.workbook", "Verifying _UCM_Server_files.xlsx"),
                "Sheet1", SCENARIO, "type the names");
        return namesFromStep(step);
    }

    public static List<String> namesFromStep(String step) {
        String[] parts = step.split("(?i)\\blike\\s+", 2);
        if (parts.length != 2) {
            throw new IllegalArgumentException("Scenario 14 has no process-name list");
        }
        List<String> names = Arrays.stream(parts[1].split(",", -1)).map(String::trim).toList();
        if (names.isEmpty() || names.stream().anyMatch(String::isBlank)) {
            throw new IllegalArgumentException("Scenario 14 contains a blank process name");
        }
        return names.stream().distinct().toList();
    }
}