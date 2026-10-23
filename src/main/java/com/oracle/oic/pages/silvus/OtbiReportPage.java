package com.oracle.oic.pages.silvus;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

import java.util.ArrayList;
import java.util.List;
import java.nio.file.Path;
import java.util.regex.Pattern;

/** Reads the visible OTBI output tab after the verified report navigation. */
public class OtbiReportPage extends BasePage {

    public OtbiReportPage(Page page) {
        super(page);
    }

    public String readReportText() {
        waitForURL(
                Pattern.compile(".*/analytics/saw\\.dll\\?Answers.*"),
                ConfigReader.getNavigationTimeout());
        waitForLoadState(LoadState.NETWORKIDLE);
        return locator("body").innerText();
    }

    public List<List<String>> readTableRows() {
        waitForVisible(locator("table.ViewTable"), 20_000);
        page.waitForLoadState();
        var table = locator("table.ViewTable");
        waitForVisible(table, 20_000);
        // The live OTBI table renders multiple data rows; use the first USD row as the
        // verified readiness signal before reading the full table snapshot.
        var populatedRows = table.locator("tr:has(> td:nth-child(8))")
            .filter(new Locator.FilterOptions().setHasText("USD"));
        waitForVisible(populatedRows.first(), ConfigReader.getNavigationTimeout());
        List<List<String>> rows = new ArrayList<>();
        for (int index = 0; index < table.locator("tr").count(); index++) {
            var row = table.locator("tr").nth(index);
            List<String> cells = row.locator(":scope > td, :scope > th").allInnerTexts();
            if (cells.size() >= 8 && !cells.stream().allMatch(String::isBlank)) {
                rows.add(cells);
            }
        }
        return rows;
    }

    /** Reads the six-column participant plan-detail report, whose rows have no currency cell. */
    public List<List<String>> readParticipantPlanDetailRows() {
        waitForVisible(getByText("Results", true), 20_000);
        page.waitForLoadState();
        var table = locator("table.ViewTable table[tabindex='0']");
        waitForVisible(table, 20_000);

        List<List<String>> rows = new ArrayList<>();
        String[] carriedValues = new String[6];
        int[] carriedRows = new int[6];
        var tableRows = table.locator(":scope > tbody > tr");
        for (int rowIndex = 0; rowIndex < tableRows.count(); rowIndex++) {
            var row = tableRows.nth(rowIndex);
            List<String> values = new ArrayList<>();
            int column = 0;
            for (int cellIndex = 0; cellIndex < row.locator(":scope > td, :scope > th").count(); cellIndex++) {
                while (column < carriedRows.length && carriedRows[column] > 0) {
                    values.add(carriedValues[column]);
                    carriedRows[column]--;
                    column++;
                }
                var cell = row.locator(":scope > td, :scope > th").nth(cellIndex);
                String value = cell.innerText().trim();
                int rowSpan = span(cell, "rowspan");
                int columnSpan = span(cell, "colspan");
                for (int spanColumn = 0; spanColumn < columnSpan && column + spanColumn < values.size(); spanColumn++) {
                    values.set(column + spanColumn, value);
                }
                while (values.size() < column + columnSpan) {
                    values.add(value);
                }
                if (rowSpan > 1) {
                    for (int spanColumn = 0; spanColumn < columnSpan && column + spanColumn < carriedRows.length; spanColumn++) {
                        carriedValues[column + spanColumn] = value;
                        carriedRows[column + spanColumn] = rowSpan - 1;
                    }
                }
                column += columnSpan;
            }
            while (column < carriedRows.length) {
                if (carriedRows[column] > 0) {
                    values.add(carriedValues[column]);
                    carriedRows[column]--;
                } else {
                    values.add("");
                }
                column++;
            }
            if (!values.stream().allMatch(String::isBlank)) {
                rows.add(values);
            }
        }
        return rows;
    }

    /** Reads the quota report's 13-column grouped table verified in Dev3 on 2026-09-23. */
    public List<List<String>> readRevenueQuotaRows() {
        var table = locator("table.ViewTable table[tabindex='0']");
        waitForVisible(table, ConfigReader.getNavigationTimeout());
        showAllRows();
        var tableRows = table.locator(":scope > tbody > tr");
        var header = tableRows.filter(new Locator.FilterOptions().setHasText("Business Unit Name"));
        waitForVisible(header, ConfigReader.getNavigationTimeout());

        List<List<String>> rows = new ArrayList<>();
        String[] carriedValues = new String[13];
        int[] carriedRows = new int[13];
        int headerIndex = -1;
        for (int rowIndex = 0; rowIndex < tableRows.count(); rowIndex++) {
            if (tableRows.nth(rowIndex).innerText().contains("Business Unit Name")) {
                headerIndex = rowIndex;
                break;
            }
        }
        for (int rowIndex = headerIndex + 1; rowIndex < tableRows.count(); rowIndex++) {
            var row = tableRows.nth(rowIndex);
            List<String> values = new ArrayList<>();
            int column = 0;
            var cells = row.locator(":scope > td, :scope > th");
            for (int cellIndex = 0; cellIndex < cells.count(); cellIndex++) {
                while (column < carriedRows.length && carriedRows[column] > 0) {
                    values.add(carriedValues[column]);
                    carriedRows[column]--;
                    column++;
                }
                var cell = cells.nth(cellIndex);
                String value = cell.innerText().trim();
                int rowSpan = span(cell, "rowspan");
                int columnSpan = span(cell, "colspan");
                while (values.size() < column + columnSpan) {
                    values.add(value);
                }
                for (int spanColumn = 0; spanColumn < columnSpan && column + spanColumn < values.size(); spanColumn++) {
                    values.set(column + spanColumn, value);
                }
                if (rowSpan > 1) {
                    for (int spanColumn = 0; spanColumn < columnSpan && column + spanColumn < carriedRows.length; spanColumn++) {
                        carriedValues[column + spanColumn] = value;
                        carriedRows[column + spanColumn] = rowSpan - 1;
                    }
                }
                column += columnSpan;
            }
            while (column < carriedRows.length) {
                if (carriedRows[column] > 0) {
                    values.add(carriedValues[column]);
                    carriedRows[column]--;
                } else {
                    values.add("");
                }
                column++;
            }
            if (!values.stream().allMatch(String::isBlank)) {
                rows.add(values);
            }
        }
        return rows;
    }

    public Path downloadFormattedExcel(Path targetPath) {
        var exportLink = getByRole(AriaRole.LINK, "Export", true);
        click(exportLink);
        click(getByRole(AriaRole.MENUITEM, "Formatted", true));
        var excel = getByRole(AriaRole.MENUITEM, "Excel", true);
        var download = downloadFile(() -> click(excel));
        download.saveAs(targetPath);
        return targetPath;
    }

    private void showAllRows() {
        var allRows = getByTitle("Display maximum (500) rows per page", true);
        waitForVisible(allRows, ConfigReader.getNavigationTimeout());
        click(allRows);
        waitForVisible(
                getByText(Pattern.compile("Rows\\s+\\d+\\s+-\\s+\\d+\\s+\\(All Rows\\)")),
                ConfigReader.getNavigationTimeout());
    }
    private int span(Locator cell, String attribute) {
        String value = cell.getAttribute(attribute);
        return value == null || value.isBlank() ? 1 : Integer.parseInt(value);
    }

    public void returnToFusionPage() {
        switchToTab(0);
    }
}