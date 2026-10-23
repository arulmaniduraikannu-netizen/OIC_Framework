package com.oracle.oic.tests.silvus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ReportsAnalyticsPage;
import com.oracle.oic.pages.silvus.OtbiReportPage;
import com.oracle.oic.pages.silvus.SilvusCatalogPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;

/** Verifies the fourth Silvus workbook scenario by downloading the Dev4 OTBI export. */
public class SilvusAttainmentTest extends BaseTest {

    private static final String WORKBOOK = "Silvus RW Dashboard Analysis-Dev3.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "4.Verifying the RW_LMR_Attainment Report";

    @Test(description = "Verifies the Silvus RW LMR Attainment OTBI report")
    public void verifySilvusAttainment() throws Exception {
        String reportName = readReportName();
        var homePage = loginToFusionHome();

        ReportsAnalyticsPage reports = new ReportsAnalyticsPage(getPage());
        homePage.openReportsAndAnalytics();
        SilvusCatalogPage catalog = reports.openSilvusCatalog();
        OtbiReportPage otbiPage = catalog.openSilvusReport(reportName);

        Path report = Paths.get("test-results/reports/Silvus_RW_LMR_Attainment.xlsx");
        Files.deleteIfExists(report);
        otbiPage.downloadFormattedExcel(report);
        System.out.println("Silvus RW LMR Attainment report: " + report.toAbsolutePath());
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