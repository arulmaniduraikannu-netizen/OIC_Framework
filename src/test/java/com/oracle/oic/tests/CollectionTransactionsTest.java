package com.oracle.oic.tests;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.CollectionTransactionsPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.utils.ExtentReportManager;

/** Runs the workbook's Collect Transactions process with its supplied parameters. */
public class CollectionTransactionsTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "5.Run the collection Process";
    private static final Pattern DATE_PATTERN = Pattern.compile(
            "(\\d{2})/(\\d{2})/(\\d{4})");

    @Test(description = "Runs the workbook Collect Transactions process")
    public void collectionProcessCanBeSubmitted() {
        var homePage = loginToFusionHome();
        homePage.openCreditsAndEarnings();

        CollectionTransactionsPage collectionPage = new CollectionTransactionsPage(getPage());
        collectionPage.waitForPage();

        String businessUnit = readBusinessUnit();
        LocalDate fromDate = readDate("Set From date");
        LocalDate toDate = readDate("To Date");

        collectionPage.selectBusinessUnit(businessUnit);
        collectionPage.setFromDate(fromDate);
        collectionPage.setToDate(toDate);

        Assert.assertEquals(collectionPage.getFromDateValue(), formatUiDate(fromDate));
        Assert.assertEquals(collectionPage.getToDateValue(), formatUiDate(toDate));
       // String transactionId = collectionPage.submit();
       // System.out.println("Transaction ID: " + transactionId);
        //ExtentReportManager.info("Transaction ID: " + transactionId);
        
    }

    private String readBusinessUnit() {
        String step = WorkbookScenarioReader.findCellContaining(
            WORKBOOK, SHEET, SCENARIO, "Then Business");
        int selectIndex = step.toLowerCase().lastIndexOf("select");
        if (selectIndex < 0) {
            throw new IllegalArgumentException("Business Unit value not found in workbook step: " + step);
        }
        return step.substring(selectIndex + "select".length()).trim();
    }

    private LocalDate readDate(String marker) {
        String step = WorkbookScenarioReader.findCellContaining(
            WORKBOOK, SHEET, SCENARIO, marker);
        Matcher matcher = DATE_PATTERN.matcher(step);
        List<LocalDate> dates = new ArrayList<>();
        while (matcher.find()) {
            dates.add(LocalDate.of(
                    Integer.parseInt(matcher.group(3)),
                    Integer.parseInt(matcher.group(2)),
                    Integer.parseInt(matcher.group(1))));
        }
        int dateIndex = marker.equals("To Date") ? 1 : 0;
        if (dates.size() <= dateIndex) {
            throw new IllegalArgumentException("Date value not found in workbook step: " + step);
        }
        return dates.get(dateIndex);
    }

    private String formatUiDate(LocalDate date) {
        return date.format(DateTimeFormatter.ofPattern("M/d/yy"));
    }
}