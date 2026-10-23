package com.oracle.oic.tests.silvus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.ReportsAnalyticsPage;
import com.oracle.oic.pages.silvus.ManageEarningsPage;
import com.oracle.oic.pages.silvus.OtbiReportPage;
import com.oracle.oic.pages.silvus.ParticipantSnapshotPage;
import com.oracle.oic.pages.silvus.SilvusCatalogPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.utils.SilvusComparisonReportWriter;
import com.oracle.oic.utils.SilvusComparisonReportWriter.SourceRow;
import com.oracle.oic.utils.ValueNormalizer;

/** First Silvus Dev3 workbook scenario, using the Phase 2 verified UI contract. */
public class SilvusRwDashboardAnalysisTest extends BaseTest {

    private static final String WORKBOOK = "Silvus RW Dashboard Analysis-Dev3.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "Verifying the QTD Earnings for silvus(Overview)";
    private static final Pattern DATE_VALUE = Pattern.compile("\\b\\d{2}/\\d{2}/\\d{4}\\b");
    @Test(description = "Compares Silvus Dev3 Manage Earnings with the OTBI report")
    public void compareSilvusEarningsSources() throws Exception {
        ScenarioData scenario = readScenario();
        var homePage = loginToFusionHome();

        ReportsAnalyticsPage reports = new ReportsAnalyticsPage(getPage());
        homePage.openReportsAndAnalytics();
        SilvusCatalogPage catalog = reports.openSilvusCatalog();
        OtbiReportPage otbiPage = catalog.openSilvusReport(scenario.reportName());
        List<SourceRow> otbiRows = parseOtbiRows(otbiPage.readTableRows());
        otbiPage.returnToFusionPage();

        ParticipantSnapshotPage participantSnapshot = new ParticipantSnapshotPage(getPage());
        participantSnapshot.openFromHome();
        participantSnapshot.openManageEarnings(scenario.participant(), scenario.plan());
        ManageEarningsPage manageEarnings = new ManageEarningsPage(getPage());
        manageEarnings.searchFromDate(scenario.fromDate());
        List<ManageEarningsPage.EarningsRow> manageEarningsRows = manageEarnings.readAllRowsThroughDecember();
        List<SourceRow> manageRows = manageEarningsRows.stream()
                .map(row -> toSourceRow(row, scenario))
                .toList();
        List<String> comparisonPeriods = otbiRows.stream()
            .filter(row -> scenario.participant().equals(row.participant()))
            .map(SourceRow::month)
            .filter(this::isOctoberThroughDecember)
            .distinct()
            .toList();
        List<SourceRow> comparisonManageRows = manageRows.stream()
            .filter(row -> scenario.participant().equals(row.participant()))
            .filter(row -> comparisonPeriods.contains(row.month()))
            .toList();
        List<SourceRow> comparisonOtbiRows = otbiRows.stream()
            .filter(row -> scenario.participant().equals(row.participant()))
            .filter(row -> comparisonPeriods.contains(row.month()))
            .toList();

        Path report = Paths.get("test-results/reports/Silvus_RW_Dashboard_Comparison.xlsx");
        Files.deleteIfExists(report);
        SilvusComparisonReportWriter.write(manageRows, otbiRows, comparisonManageRows,
            comparisonOtbiRows, report);
        Assert.assertFalse(manageRows.isEmpty(), "No Manage Earnings rows were captured");
        Assert.assertFalse(otbiRows.isEmpty(), "No OTBI rows were captured");
        Assert.assertEquals(comparisonPeriods, List.of("202610", "202611", "202612"),
            "Comparison must cover Gregory Smith for October through December");
        long uniqueManageComparisonRows = comparisonManageRows.stream()
            .map(SourceRow::key)
            .distinct()
            .count();
        Assert.assertEquals(uniqueManageComparisonRows, 6,
            "Manage comparison must contain two components for each month");
        Assert.assertEquals(comparisonOtbiRows.size(), 6,
            "OTBI comparison must contain two components for each month");
        Assert.assertTrue(otbiRows.stream().allMatch(row -> "VSA".equals(row.businessUnit())),
            "OTBI business unit must remain VSA");
        Assert.assertTrue(otbiRows.stream().noneMatch(row -> "Gregory Smith".equals(row.businessUnit())),
            "OTBI participant must not be shifted into Business Unit");
        Assert.assertTrue(Files.exists(report), "Comparison workbook was not generated");
        System.out.println("Silvus comparison report: " + report.toAbsolutePath());
    }

    private ScenarioData readScenario() {
        List<Object[]> rows = WorkbookScenarioReader.scenarioRows(WORKBOOK, SHEET, SCENARIO);
        String participant = extract(rows, "participant name with ", "Gregory Smith");
        String plan = extract(rows, "plan name as ", "SILVUS VP/DIR PLAN 2026");
        String fromDate = extractDate(rows, "From Date as ", "01/01/2026");
        String reportName = extract(rows, "4.click on the ", "SIL_RW_Tile_LMR_QTD Earning Report");
        return new ScenarioData(participant, plan, fromDate, reportName);
    }

    private String extractDate(List<Object[]> rows, String marker, String fallback) {
        String value = extract(rows, marker, fallback);
        Matcher matcher = DATE_VALUE.matcher(value);
        return matcher.find() ? matcher.group() : fallback;
    }

    private String extract(List<Object[]> rows, String marker, String fallback) {
        for (Object[] row : rows) {
            for (Object value : row) {
                if (value != null) {
                    String text = value.toString();
                    int start = text.toLowerCase().indexOf(marker.toLowerCase());
                    if (start >= 0) {
                        String result = text.substring(start + marker.length())
                                .replaceAll("[.)]+$", "").trim();
                        return result;
                    }
                }
            }
        }
        return fallback;
    }

    private SourceRow toSourceRow(ManageEarningsPage.EarningsRow row, ScenarioData scenario) {
        String plan = row.plan().isBlank() ? scenario.plan() : row.plan();
        return new SourceRow(month(row.eventDate()), row.businessUnit(), row.participant(), plan,
            row.planComponent(), row.earningAmount(), row.homeCurrencyCode(),
            row.homeCurrencyConversionRate(), row.earningAmountInHomeCurrency(), row.processStatus());
    }

    private List<SourceRow> parseOtbiRows(List<List<String>> tableRows) {
        List<SourceRow> rows = new java.util.ArrayList<>();
        String period = "";
        String businessUnit = "";
        String participant = "";
        String plan = "";
        for (List<String> cells : tableRows) {
            int participantIndex;
            if ("Year".equalsIgnoreCase(cell(cells, 0))) {
                continue;
            }
            if (cell(cells, 1).matches("\\d{6}")) {
                period = cell(cells, 1);
                businessUnit = cell(cells, 2);
                participantIndex = 3;
            } else if (cell(cells, 0).matches("\\d{6}")) {
                period = cell(cells, 0);
                businessUnit = cell(cells, 1);
                participantIndex = 2;
            } else if (!period.isBlank()) {
                participantIndex = 0;
            } else {
                continue;
            }
            if (period.isBlank() || cells.size() < participantIndex + 8) {
                continue;
            }
                if (participantIndex == 0 && cell(cells, 0).matches("(?:ORDER|REVENUE).*")) {
                rows.add(new SourceRow(period, businessUnit, participant, plan,
                    cell(cells, 0), cell(cells, 1), cell(cells, 2), cell(cells, 3),
                    cell(cells, 4), ""));
                continue;
                }
                participant = cell(cells, participantIndex);
                plan = cell(cells, participantIndex + 1);
            rows.add(new SourceRow(period, businessUnit,
                    participant, plan,
                    cell(cells, participantIndex + 2), cell(cells, participantIndex + 3),
                    cell(cells, participantIndex + 4), cell(cells, participantIndex + 5),
                    cell(cells, participantIndex + 6), ""));
        }
        return rows;
    }

    private String cell(List<String> cells, int index) {
        return index < cells.size() ? cells.get(index).trim() : "";
    }

    private String month(String date) {
        String normalized = ValueNormalizer.normalizeDate(date);
        return normalized.length() >= 7 ? normalized.substring(0, 7).replace("-", "") : normalized;
    }

    private boolean isOctoberThroughDecember(String period) {
        return period.matches("\\d{4}(10|11|12)");
    }

    private record ScenarioData(String participant, String plan, String fromDate, String reportName) {
    }
}