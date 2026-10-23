package com.oracle.oic.tests;

import java.nio.file.Path;
import java.util.List;

import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.monitor.AlertStateStore;
import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.monitor.LongRunningProcessMonitor;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.ScheduledProcessWorkbookSupport;
import com.oracle.oic.utils.GoogleChatNotifier;

/** Runs one recurring monitor cycle against the live Fusion Scheduled Processes page. */
public class ScheduledProcessMonitorCycleTest extends BaseTest {

    @Test(description = "Scans recent scheduled processes and sends newly crossed alerts")
    public void runMonitorCycle() {
                List<String> rootNames = ScheduledProcessWorkbookSupport.rootNames();
        var homePage = loginToFusionHome();
        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());

        homePage.openScheduledProcesses();
        List<LongRunningProcess> processes = scheduledProcessesPage.collectProcessesLast72Hours(rootNames);
        if (Boolean.getBoolean("oic.monitor.collectionOnly")) {
            org.testng.Assert.assertFalse(processes.isEmpty(), "No workbook-root processes were collected");
            System.out.printf("Collection-only cycle completed: %d roots; %d unique processes; notifications disabled%n",
                    rootNames.size(), processes.size());
            return;
        }

        Path statePath = Path.of(System.getenv().getOrDefault(
                "OIC_MONITOR_STATE_PATH",
                ".oic-runner/monitor-alert-state.properties"));
        LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                () -> processes,
                new AlertStateStore(statePath),
                new GoogleChatNotifier());
        monitor.runOnce();

        System.out.printf("Monitor cycle completed: %d processes inspected; state: %s%n",
                processes.size(), statePath.toAbsolutePath());
    }
}