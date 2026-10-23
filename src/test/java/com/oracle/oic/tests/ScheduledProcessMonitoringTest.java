package com.oracle.oic.tests;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ScheduledProcessResult;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.utils.GoogleChatNotifier;

/** Verifies scenario 12 and publishes its verified process result to Google Chat when configured. */
public class ScheduledProcessMonitoringTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "12.Monitoring the schedule Process";
    private static final Pattern PROCESS_ID_PATTERN = Pattern.compile("\\b(\\d{7})\\b");

    @Test(description = "Verifies scenario 12 scheduled-process status and notifies Google Chat")
    public void scheduledProcessResultCanBePublished() {
        String processId = readProcessId();
        var homePage = loginToFusionHome();
        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());

        homePage.openScheduledProcesses();
        scheduledProcessesPage.searchProcess(processId);
        ScheduledProcessResult result = scheduledProcessesPage.getProcessResult(processId);

        System.out.printf(
            "Process ID: %s%nProcess: %s%nStatus: %s%nSubmitted: %s%nCompleted: %s%nDuration: %s%n",
            result.processId(), result.processName(), result.status(),
            result.submissionTime(), result.completionTime(), result.duration());

        new GoogleChatNotifier().notifyProcess(result);
    }

    private String readProcessId() {
        for (Object[] row : WorkbookScenarioReader.scenarioRows(WORKBOOK, SHEET, SCENARIO)) {
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
        throw new IllegalArgumentException("No process ID found in workbook scenario: " + SCENARIO);
    }
}