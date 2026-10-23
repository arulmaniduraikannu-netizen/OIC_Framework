package com.oracle.oic.tests;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.utils.ExcelReader;

public class JobProcessStatusTest extends BaseTest {

    private static final String WORKBOOK = "steps to run the job process.xlsx";
    private static final String SHEET = "Sheet1";
    private static final Pattern PROCESS_ID_PATTERN = Pattern.compile("\\b(\\d{7})\\b");

    @Test(description = "Searches the process ID from Excel and prints its status")
    public void jobProcessStatusCanBeReadFromExcel() {
        String processId = readProcessIdFromWorkbook();

        var homePage = loginToFusionHome();
        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());
        homePage.openScheduledProcesses();
        scheduledProcessesPage.searchProcess(processId);

        String status = scheduledProcessesPage.getProcessStatus(processId);
        System.out.println("Process ID " + processId + " status: " + status);
        Assert.assertFalse(status.isBlank(), "Expected a value in the Status column for process ID " + processId);
    }

    private String readProcessIdFromWorkbook() {
        Object[][] rows = ExcelReader.readRows(WORKBOOK, SHEET);
        for (Object[] row : rows) {
            for (Object value : row) {
                if (value == null) {
                    continue;
                }
                Matcher matcher = PROCESS_ID_PATTERN.matcher(value.toString());
                if (matcher.find()) {
                    return matcher.group(1);
                }
            }
        }
        throw new IllegalArgumentException("No process ID found in workbook: " + WORKBOOK);
    }
}