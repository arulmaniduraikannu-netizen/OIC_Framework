package com.oracle.oic.tests.support;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.CatalogPage;
import com.oracle.oic.pages.DataModelPage;
import com.oracle.oic.pages.ReportsAnalyticsPage;

public abstract class WorkbookSqlTestSupport extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String WORKBOOK_FALLBACK = "Verifying _UCM_Server_files1.xlsx";
    private static final String SHEET = "Sheet1";
    private static final Pattern ROW_LIMIT_PATTERN = Pattern.compile(
            "enter values\\s+(\\d+)", Pattern.CASE_INSENSITIVE);

    protected DataModelPage openDataModelFromWorkbookFlow() {
        var homePage = loginToFusionHome();
        homePage.openReportsAndAnalytics();

        ReportsAnalyticsPage reportsPage = new ReportsAnalyticsPage(getPage());
        reportsPage.waitForPage();
        CatalogPage catalogPage = reportsPage.openCatalog();
        DataModelPage dataModelPage = catalogPage.createDataModel();
        dataModelPage.waitForEditor();
        return dataModelPage;
    }

    protected String workbookQuery(String scenario, String marker) {
        String queryStep = findWorkbookCell(scenario, marker);
        int selectIndex = queryStep.toLowerCase().indexOf("select");
        if (selectIndex < 0) {
            throw new IllegalArgumentException("SQL query not found in workbook step: " + queryStep);
        }
        return queryStep.substring(selectIndex).trim();
    }

    protected int workbookRowLimit(String scenario, String marker) {
        String rowsStep = findWorkbookCell(scenario, marker);
        Matcher rowLimitMatcher = ROW_LIMIT_PATTERN.matcher(rowsStep);
        if (!rowLimitMatcher.find()) {
            throw new IllegalArgumentException("Rows value not found in workbook step: " + rowsStep);
        }
        return Integer.parseInt(rowLimitMatcher.group(1));
    }

    protected void assertCountRendered(String dataText, String message) {
        Assert.assertTrue(dataText.contains("COUNT___"), message);
    }

    private String findWorkbookCell(String scenario, String marker) {
        try {
            return WorkbookScenarioReader.findCellContaining(WORKBOOK, SHEET, scenario, marker);
        } catch (IllegalArgumentException primaryFailure) {
            return WorkbookScenarioReader.findCellContaining(WORKBOOK_FALLBACK, SHEET, scenario, marker);
        }
    }
}