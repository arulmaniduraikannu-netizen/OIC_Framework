package com.oracle.oic.tests;

import static org.testng.Assert.assertFalse;

import java.util.List;

import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.ScheduledProcessWorkbookSupport;

/** Read-only scenario 14 collection using the 22 October 2026 Phase 2 hierarchy contract. */
public class ScheduledProcessLongRunningInspectionTest extends BaseTest {

    private static final long ONE_HOUR_MINUTES = 60;

    @Test(description = "Inspects all recent scheduled processes and reports long-running processes")
    public void inspectLongRunningProcesses() {
        List<String> rootNames = ScheduledProcessWorkbookSupport.rootNames();
        var homePage = loginToFusionHome();
        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());

        homePage.openScheduledProcesses();
        List<LongRunningProcess> processes = scheduledProcessesPage.collectProcessesLast72Hours(rootNames);
        assertFalse(processes.isEmpty(), "No scheduled processes were collected from Fusion.");

        System.out.printf("Collected %d scheduled processes.%n", processes.size());
        for (LongRunningProcess process : processes) {
            printProcess("PROCESS", process);
        }

        List<LongRunningProcess> longRunningProcesses = processes.stream()
                .filter(process -> process.elapsed() != null
                    && process.elapsed().toMinutes() >= ONE_HOUR_MINUTES)
                .toList();
        System.out.printf("Processes at or above 60 minutes: %d%n", longRunningProcesses.size());
        for (LongRunningProcess process : longRunningProcesses) {
            printProcess("LONG-RUNNING", process);
        }
    }

    private void printProcess(String category, LongRunningProcess process) {
        System.out.printf(
                "[%s] ID: %s%n"
                        + "  Name: %s%n"
                        + "  Status: %s%n"
                        + "  Submitter: %s%n"
                        + "  Submitted: %s%n"
                        + "  Started: %s%n"
                        + "  Completed: %s%n"
                        + "  Elapsed: %s%n",
                category, process.processId(), process.processName(), process.status(),
                process.submitter(), process.submissionTime(), process.startTime(),
                process.completionTime(), formatDuration(process));
    }

    private String formatDuration(LongRunningProcess process) {
        if (!"Unavailable".equals(process.displayDuration())) {
            return process.displayDuration();
        }
        if (process.elapsed() == null) {
            return "Unavailable";
        }
        long minutes = process.elapsed().toMinutes();
        return (minutes / 60) + " hours " + (minutes % 60) + " minutes";
    }
}
