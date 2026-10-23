package com.oracle.oic.tests;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;

/**
 * Verifies the Oracle Fusion Scheduled Processes flow for selecting an
 * existing VSA Job Set before submission.
 *
 * The interaction sequence and locators were validated during Phase 2 with
 * Playwright MCP against the live Oracle Fusion tenant.
 */
public class ScheduledProcessesTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "4.Run the job set process";
    private static final Pattern DATE_PATTERN = Pattern.compile(
            "(\\d{2})/(\\d{2})/(\\d{4})");

    @Test(description = "Verifies the VSA Job Set selection path in Scheduled Processes")
    public void existingVsaJobSetCanBeSelected() {
        var homePage = loginToFusionHome();
        ScheduledProcessesPage scheduledProcessesPage = new ScheduledProcessesPage(getPage());

        homePage.openScheduledProcesses();
        scheduledProcessesPage.openScheduleNewProcess();
        scheduledProcessesPage.selectJobSetType();
    scheduledProcessesPage.selectJobSetName(readValue("Calculation Jobset"));
       scheduledProcessesPage.selectOptionByName("Collect Transactions");
    scheduledProcessesPage.selectParameterValue("Business Unit", readValue("Business Uint"));
    scheduledProcessesPage.selectParameterValue("Source Business Unit", readValue("Source Business"));
    scheduledProcessesPage.selectParameterValue("Transaction Type", readValue("Transaction type"));
     LocalDate fromDate = readDate("Set From date");
     LocalDate toDate = readDate("To Date");
     scheduledProcessesPage.setFromDate(fromDate);

       // verify value (format M/d/yy)
    String expected = fromDate.format(DateTimeFormatter.ofPattern("M/d/yy"));
       Assert.assertEquals(scheduledProcessesPage.getFromDateValue(), expected);

        // set To Date example: Jan 31, 2026
        scheduledProcessesPage.setToDate(toDate);
        String expectedTo = toDate.format(DateTimeFormatter.ofPattern("M/d/yy"));
        Assert.assertEquals(scheduledProcessesPage.getToDateValue(), expectedTo);

       
      
       System.out.println("ok button clicked");
       // Assert.assertTrue(scheduledProcessesPage.click_OK_Button().isEnabled(), "OK button should be enabled after selecting a job set.");
     scheduledProcessesPage.selectOptionByName("Revert Incentive Transactions");   
    scheduledProcessesPage.selectParameterValue("Business Unit", readValue("Then Business Uint"));
    scheduledProcessesPage.setFromDate(fromDate);
    String expected1 = fromDate.format(DateTimeFormatter.ofPattern("M/d/yy"));
     Assert.assertEquals(scheduledProcessesPage.getFromDateValue(), expected1);
    
    scheduledProcessesPage.setToDate(toDate);
    String expectedTo1 = toDate.format(DateTimeFormatter.ofPattern("M/d/yy"));
     Assert.assertEquals(scheduledProcessesPage.getToDateValue(), expectedTo1);
    // fill submission notes for Scenario 1
String scenarioNotes = "Scenario 1 - Automated run: verify VSA path";
scheduledProcessesPage.setSubmissionNotes(scenarioNotes);
Assert.assertEquals(scheduledProcessesPage.getSubmissionNotesValue(), scenarioNotes);


    }

    private String readValue(String marker) {
        String step = WorkbookScenarioReader.findCellContaining(WORKBOOK, SHEET, SCENARIO, marker);
        String lowerStep = step.toLowerCase();
        int valueIndex = lowerStep.lastIndexOf("select");
        String keyword = "select";
        if (valueIndex < 0) {
            valueIndex = lowerStep.lastIndexOf("as");
            keyword = "as";
        }
        if (valueIndex < 0) {
            throw new IllegalArgumentException("Value not found in workbook step: " + step);
        }
        String value = step.substring(valueIndex + keyword.length()).trim();
        return value.equals("ORDER1") ? "ORDER 1" : value;
    }

    private LocalDate readDate(String marker) {
        String step = WorkbookScenarioReader.findCellContaining(WORKBOOK, SHEET, SCENARIO, marker);
        Matcher matcher = DATE_PATTERN.matcher(step);
        if (!matcher.find()) {
            throw new IllegalArgumentException("Date value not found in workbook step: " + step);
        }
        return LocalDate.of(Integer.parseInt(matcher.group(3)),
                Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(1)));
    }
}
