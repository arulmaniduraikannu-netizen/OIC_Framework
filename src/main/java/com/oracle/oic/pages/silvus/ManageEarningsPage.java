package com.oracle.oic.pages.silvus;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;
import com.oracle.oic.utils.ValueNormalizer;

/** Manage Earnings extraction for the verified Silvus Dev3 workflow. */
public class ManageEarningsPage extends BasePage {

    public ManageEarningsPage(Page page) {
        super(page);
    }

    private Locator fromDateField() {
        return getByRole(AriaRole.TEXTBOX, "From Date", true);
    }

    private Locator searchButton() {
        return getByRole(AriaRole.BUTTON, "Search", true);
    }

    private Locator resultsTable() {
        return getByRole(AriaRole.TABLE, "Manage Earnings: Search Results:", true);
    }

    private Locator resultsGridBody() {
        // Oracle renders the virtualized results body without an accessible scroll container.
        return locator("div[id=\"_FOpt1:_FOr1:0:_FONSr2:0:MAt2:0:pt1:AP1:rsltAT:_ATp:rltTbl::db\"]");
    }

    public void searchFromDate(String fromDate) {
        fill(fromDateField(), fromDate);
        click(searchButton());
        waitForVisible(resultsTable(), ConfigReader.getNavigationTimeout());
    }

    public List<EarningsRow> readRows() {
        return readRowsWithCarry("").rows();
    }

    public List<EarningsRow> readAllRowsThroughDecember() {
        Locator gridBody = resultsGridBody();
        waitForVisible(gridBody, ConfigReader.getNavigationTimeout());
        scrollToTop(gridBody);

        Map<String, EarningsRow> uniqueRows = new LinkedHashMap<>();
        String lastEventDate = "";
        boolean decemberSeen = false;
        double previousScrollTop = -1;
        for (int pass = 0; pass < 100; pass++) {
            RowCapture capture = readRowsWithCarry(lastEventDate);
            lastEventDate = capture.lastEventDate();
            for (EarningsRow row : capture.rows()) {
                uniqueRows.putIfAbsent(rowKey(row), row);
                decemberSeen = decemberSeen || isDecember(row.eventDate());
            }

            double scrollTop = scrollTop(gridBody);
            double maximumScrollTop = maximumScrollTop(gridBody);
            if (decemberSeen && scrollTop >= maximumScrollTop - 1
                    || scrollTop >= maximumScrollTop - 1 && scrollTop == previousScrollTop) {
                return new ArrayList<>(uniqueRows.values());
            }
            previousScrollTop = scrollTop;
            scrollBy(gridBody, Math.max(1, (int) gridBody.boundingBox().height - 40));
        }
        throw new IllegalStateException("Manage Earnings grid did not reach December within the scroll limit");
    }

    private RowCapture readRowsWithCarry(String carriedEventDate) {
        Locator rows = resultsTable().getByRole(AriaRole.ROW);
        rows.first().waitFor(new Locator.WaitForOptions().setTimeout(ConfigReader.getNavigationTimeout()));
        List<EarningsRow> values = new ArrayList<>();
        String lastEventDate = carriedEventDate;
        String lastBusinessUnit = "";
        String lastParticipant = "";
        String lastPlan = "";
        for (int index = 1; index < rows.count(); index++) {
            List<String> cells = rows.nth(index).getByRole(AriaRole.CELL).allInnerTexts();
            if (cells.size() >= 6 && !cells.stream().allMatch(String::isBlank)) {
                EarningsRow row = EarningsRow.fromCells(cells);
                if (!row.eventDate().isBlank()) {
                    lastEventDate = row.eventDate();
                }
                if (!row.businessUnit().isBlank()) {
                    lastBusinessUnit = row.businessUnit();
                }
                if (!row.participant().isBlank()) {
                    lastParticipant = row.participant();
                }
                if (!row.plan().isBlank()) {
                    lastPlan = row.plan();
                }
                EarningsRow carriedRow = new EarningsRow(lastEventDate,
                        row.businessUnit().isBlank() ? lastBusinessUnit : row.businessUnit(),
                        row.participant().isBlank() ? lastParticipant : row.participant(),
                        row.plan().isBlank() ? lastPlan : row.plan(), row.planComponent(),
                        row.earningAmount(), row.homeCurrencyCode(), row.homeCurrencyConversionRate(),
                        row.earningAmountInHomeCurrency(), row.processStatus());
                if (!carriedRow.participant().isBlank() && !carriedRow.planComponent().isBlank()
                        && !carriedRow.earningAmount().isBlank() && !carriedRow.homeCurrencyCode().isBlank()) {
                    values.add(carriedRow);
                }
            }
        }
        return new RowCapture(values, lastEventDate);
    }

    private double scrollTop(Locator gridBody) {
        return ((Number) gridBody.evaluate("element => element.scrollTop")).doubleValue();
    }

    private double maximumScrollTop(Locator gridBody) {
        return ((Number) gridBody.evaluate("element => element.scrollHeight - element.clientHeight")).doubleValue();
    }

    private String rowKey(EarningsRow row) {
        return String.join("|", canonical(row.eventDate()), canonical(row.businessUnit()),
            canonical(row.participant()), canonical(row.plan()), canonical(row.planComponent()),
            canonical(row.earningAmount()), canonical(row.homeCurrencyCode()),
            canonical(row.homeCurrencyConversionRate()), canonical(row.earningAmountInHomeCurrency()),
            canonical(row.processStatus()));
    }

    private String canonical(String value) {
        return ValueNormalizer.normalizeText(value == null ? "" : value.replace('\u00a0', ' '))
                .replaceAll("\\s+", " ");
    }

    private boolean isDecember(String eventDate) {
        return eventDate.matches("12/\\d{1,2}/\\d{2,4}");
    }

    private record RowCapture(List<EarningsRow> rows, String lastEventDate) {
    }

        public record EarningsRow(String eventDate, String businessUnit, String participant, String plan,
            String planComponent, String earningAmount, String homeCurrencyCode,
            String homeCurrencyConversionRate, String earningAmountInHomeCurrency,
            String processStatus) {
        private static final Pattern DATE = Pattern.compile("\\d{1,2}/\\d{1,2}/\\d{2,4}");
        private static final Pattern AMOUNT = Pattern.compile("[-+]?\\d[\\d,]*(?:\\.\\d+)?\\s*[A-Za-z]{3}");
        private static final Pattern CURRENCY = Pattern.compile("[A-Za-z]{3}");
        private static final Pattern COMPONENT = Pattern.compile("(?:ORDER|REVENUE)\\b.*", Pattern.CASE_INSENSITIVE);

        private static EarningsRow fromCells(List<String> cells) {
            String eventDate = find(cells, DATE, 0, cells.size());
            int componentIndex = findIndex(cells, COMPONENT, 0, cells.size());
            int firstAmountIndex = findAmountIndex(cells, componentIndex + 1, cells.size());
            String earningAmount = firstAmountIndex < 0 ? "" : match(cells.get(firstAmountIndex), AMOUNT);
            int lastAmountIndex = lastAmountIndex(cells);
            String homeAmount = lastAmountIndex < 0 ? "" : match(cells.get(lastAmountIndex), AMOUNT);
            String businessUnit = findCode(cells);
            String participant = previousText(cells, componentIndex);
                String conversionRate = conversionRateAfterCurrency(cells, firstAmountIndex + 1,
                    lastAmountIndex);
            String planComponent = componentIndex < 0 ? "" : match(cells.get(componentIndex), COMPONENT);
            String currency = firstAmountIndex < 0 ? "" : match(cells.get(firstAmountIndex), CURRENCY);
            return new EarningsRow(eventDate, businessUnit, participant, "", planComponent,
                    earningAmount, currency, conversionRate, homeAmount, lastPopulatedCell(cells));
        }

        private static String find(List<String> cells, Pattern pattern, int start, int end) {
            for (int index = start; index < end; index++) {
                String value = match(cells.get(index), pattern);
                if (!value.isBlank()) {
                    return value;
                }
            }
            return "";
        }

        private static int findIndex(List<String> cells, Pattern pattern, int start, int end) {
            for (int index = Math.max(0, start); index < end; index++) {
                if (!match(cells.get(index), pattern).isBlank()) {
                    return index;
                }
            }
            return -1;
        }

        private static int findAmountIndex(List<String> cells, int start, int end) {
            for (int index = Math.max(0, start); index < end; index++) {
                if (!match(cells.get(index), COMPONENT).isBlank()) {
                    continue;
                }
                if (!match(cells.get(index), AMOUNT).isBlank()) {
                    return index;
                }
            }
            return -1;
        }

        private static int lastAmountIndex(List<String> cells) {
            for (int index = cells.size() - 1; index >= 0; index--) {
                if (!match(cells.get(index), COMPONENT).isBlank()) {
                    continue;
                }
                if (!match(cells.get(index), AMOUNT).isBlank()) {
                    return index;
                }
            }
            return -1;
        }

        private static String match(String value, Pattern pattern) {
            var matcher = pattern.matcher(value == null ? "" : value.trim());
            return matcher.find() ? matcher.group().replace('\u00a0', ' ').trim()
                    .replaceAll("\\s+", " ") : "";
        }

        private static String findCode(List<String> cells) {
            for (String cell : cells) {
                String value = cell.trim();
                if (value.matches("[A-Z]{2,4}") && !value.equals("USD")) {
                    return value;
                }
            }
            return "";
        }

        private static String previousText(List<String> cells, int end) {
            for (int index = Math.min(end - 1, cells.size() - 1); index >= 0; index--) {
                String value = cells.get(index).trim();
                if (!value.isBlank() && !value.equals("\u00a0") && !DATE.matcher(value).matches()
                        && !value.matches("[A-Z]{2,4}") && !value.contains("Group by calculation")) {
                    return value;
                }
            }
            return "";
        }

        private static String conversionRateAfterCurrency(List<String> cells, int start, int end) {
            Pattern number = Pattern.compile("[-+]?\\d+(?:\\.\\d+)?");
            for (int index = Math.max(0, start); index + 1 < Math.min(end, cells.size()); index++) {
                if (CURRENCY.matcher(cells.get(index).trim()).matches()) {
                    String value = cells.get(index + 1).trim();
                    if (number.matcher(value).matches()) {
                        return value;
                    }
                }
            }
            return "";
        }

        private static String cell(List<String> cells, int index) {
            return index < cells.size() ? cells.get(index).trim() : "";
        }

        private static String lastPopulatedCell(List<String> cells) {
            for (int index = cells.size() - 1; index >= 0; index--) {
                String value = cells.get(index).trim();
                if (!value.isBlank() && !value.equals("\u00a0")) {
                    return value;
                }
            }
            return "";
        }
    }
}
