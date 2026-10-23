package com.oracle.oic.tests;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.utils.ExcelReader;
import com.oracle.oic.utils.ExtentReportManager;

/** Verifies the workbook purge staging-table setup without submitting the destructive process. */
public class PurgeStagingTableTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
        private static final String SCENARIO = "7.Purging for the staging table";

    @Test(description = "Verifies purge staging-table parameters from the UCM workbook")
    public void purgeTransactionStagingTableCanBeConfigured() {
        String jobStep = WorkbookScenarioReader.findCellContaining(
                WORKBOOK, SHEET, SCENARIO, "Purge Incentive Compensation Staging Table Data");
        String jobName = jobStep.substring(jobStep.indexOf("Purge"));
        String stagingStep = WorkbookScenarioReader.findCellContaining(
                WORKBOOK, SHEET, SCENARIO, "Transcation staging");
        String stagingTable = stagingStep.substring(stagingStep.indexOf("Transcation staging"),
                stagingStep.indexOf("Transcation staging") + "Transcation staging".length())
                .replace("Transcation", "Transaction");
        String acknowledgementStep = WorkbookScenarioReader.findCellContaining(
                WORKBOOK, SHEET, SCENARIO, "I understand that purged data can't be retrieved");
        String acknowledgement = acknowledgementStep.substring(acknowledgementStep.indexOf("I understand"));
        ExtentReportManager.info("Workbook values loaded: job='" + jobName
                + "', staging table='" + stagingTable + "'.");

        var homePage = loginToFusionHome();
        ExtentReportManager.info("Logged in and reached the Fusion home page.");

        homePage.openScheduledProcesses();
        ExtentReportManager.info("Opened Scheduled Processes.");

        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());
        scheduledProcessesPage.openScheduleNewProcess();
        scheduledProcessesPage.selectJobType();
        scheduledProcessesPage.selectJob(jobName);
        scheduledProcessesPage.configurePurge(stagingTable, acknowledgement);
        ExtentReportManager.info("Configured the purge staging-table parameters and acknowledgement.");

        Assert.assertTrue(scheduledProcessesPage.isSubmitEnabled(),
                "Submit should be enabled after selecting the staging table and acknowledgement.");
        ExtentReportManager.pass("Submit is enabled. The destructive purge was intentionally not submitted.");
    }
}