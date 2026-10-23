package com.oracle.oic.pages;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/** Page object for the Credits and Earnings Collect Transactions process. */
public class CollectionTransactionsPage extends BasePage {

    private static final DateTimeFormatter UI_DATE_FORMAT =
            DateTimeFormatter.ofPattern("M/d/yy");
    private static final Pattern SUBMISSION_CONFIRMATION =
            Pattern.compile("Process (\\d+) was submitted\\.");

    public CollectionTransactionsPage(Page page) {
        super(page);
    }

    private Locator collectTransactionsHeading() {
        return getByRole(AriaRole.HEADING, "Collect Transactions", true);
    }

    private Locator businessUnitSelect() {
        return getByRole(AriaRole.COMBOBOX, "Business Unit", true);
    }

    private Locator fromDateInput() {
        return getByRole(AriaRole.TEXTBOX, "From Date", true);
    }

    private Locator toDateInput() {
        return getByRole(AriaRole.TEXTBOX, "To Date", true);
    }

    private Locator submitButton() {
        return getByRole(AriaRole.BUTTON, "Submit", true);
    }

    public void waitForPage() {
        waitForVisible(collectTransactionsHeading(), ConfigReader.getNavigationTimeout());
    }

    public void selectBusinessUnit(String businessUnit) {
        waitForVisible(businessUnitSelect(), ConfigReader.getActionTimeout());
        selectOption(businessUnitSelect(), businessUnit);
    }

    public void setFromDate(LocalDate date) {
        setDate(fromDateInput(), date);
    }

    public void setToDate(LocalDate date) {
        setDate(toDateInput(), date);
    }

    public String getFromDateValue() {
        return inputValue(fromDateInput());
    }

    public String getToDateValue() {
        return inputValue(toDateInput());
    }

    public String submit() {
        waitForEnabled(submitButton(), ConfigReader.getActionTimeout());
        click(submitButton());

        Locator confirmation = getByText(SUBMISSION_CONFIRMATION);
        waitForVisible(confirmation, ConfigReader.getNavigationTimeout());
        Matcher matcher = SUBMISSION_CONFIRMATION.matcher(innerText(confirmation));
        if (!matcher.find()) {
            throw new IllegalStateException("Submission confirmation did not contain a process ID.");
        }
        return matcher.group(1);
    }

    private void setDate(Locator dateInput, LocalDate date) {
        waitForVisible(dateInput, ConfigReader.getActionTimeout());
        fill(dateInput, date.format(UI_DATE_FORMAT));
    }
}