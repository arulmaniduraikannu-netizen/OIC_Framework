package com.oracle.oic.tests.silvus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ReportsAnalyticsPage;
import com.oracle.oic.pages.silvus.OtbiReportPage;
import com.oracle.oic.pages.silvus.SilvusCatalogPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.utils.SilvusParticipantsPlanDetailReportWriter;

/** Verifies the second Silvus Dev3 workbook scenario using the existing OTBI contract. */
public class SilvusParticipantsPlanDetailTest extends BaseTest {

    private static final String WORKBOOK = "Silvus RW Dashboard Analysis-Dev3.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "verifying the SIL_RW_LMR_Participants Plan Detail";

    @Test(description = "Verifies the Silvus Participants Plan Detail OTBI report")
    public void verifySilvusParticipantsPlanDetail() throws Exception {
        String reportName = readReportName();
        var homePage = loginToFusionHome();

        ReportsAnalyticsPage reports = new ReportsAnalyticsPage(getPage());
        homePage.openReportsAndAnalytics();
        SilvusCatalogPage catalog = reports.openSilvusCatalog();
        OtbiReportPage otbiPage = catalog.openSilvusReport(reportName);
        List<List<String>> tableRows = otbiPage.readParticipantPlanDetailRows();

        Path report = Paths.get("test-results/reports/Silvus_Participants_Plan_Detail.xlsx");
        Files.deleteIfExists(report);
        SilvusParticipantsPlanDetailReportWriter.write(tableRows, report);
        Assert.assertTrue(tableRows.size() > 1,
                "Participants Plan Detail report should contain a header and data rows");
        Assert.assertTrue(Files.exists(report), "Participants Plan Detail workbook was not generated");
        System.out.println("Silvus Participants Plan Detail report: " + report.toAbsolutePath());
    }

    private String readReportName() {
        List<Object[]> rows = WorkbookScenarioReader.scenarioRows(WORKBOOK, SHEET, SCENARIO);
        for (Object[] row : rows) {
            for (Object value : row) {
                if (value == null) {
                    continue;
                }
                String text = value.toString();
                int start = text.toLowerCase().indexOf("4.click on the ");
                if (start >= 0) {
                    return text.substring(start + "4.click on the ".length())
                            .replaceAll("[.)]+$", "").trim();
                }
            }
        }
        throw new IllegalArgumentException("Report name not found in scenario: " + SCENARIO);
    }
}