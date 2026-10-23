package com.oracle.oic.pages;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/**
 * Oracle Incentive Compensation Manage Transactions workflow.
 *
 * Field roles and labels were verified from the live Manage Transactions
 * accessibility snapshot on 2026-08-08.
 */
public class TransactionsPage extends BasePage {

    public TransactionsPage(Page page) {
        super(page);
    }

    private Locator transactionNumberField() {
        return getByRole(AriaRole.TEXTBOX, "Transaction Number", true);
    }

    private Locator businessUnitField() {
        return getByRole(AriaRole.COMBOBOX, "Business Unit", true);
    }

    private Locator searchButton() {
        return getByRole(AriaRole.BUTTON, "Search", true);
    }

    private Locator transactionAmountField() {
        return getByRole(AriaRole.TEXTBOX, "Transaction Amount", true);
    }

    private Locator productDescriptionField() {
        return getByRole(AriaRole.TEXTBOX, "APC/Product Description", true);
    }

    private Locator searchResultsToggle() {
        return getByRole(AriaRole.BUTTON, "Collapse Search Results", true);
    }

    private Locator searchResultsTable() {
        return getByRole(AriaRole.TABLE, "Manage Transactions: Search Results", true);
    }

    public void searchTransaction(String transactionNumber, String businessUnit) {
        waitForVisible(transactionNumberField(), ConfigReader.getActionTimeout());
        fill(transactionNumberField(), transactionNumber);
        selectOptionByText(businessUnitField(), businessUnit);
        click(searchButton());
    }

    public void cancelTransactionEdit() {
        click(getByRole(AriaRole.BUTTON, "Cancel", true));
        waitForVisible(searchButton(), ConfigReader.getActionTimeout());
    }

    public TransactionValues readTransactionValues() {
        waitForVisible(transactionAmountField(), ConfigReader.getActionTimeout());
        String transactionAmount = inputValue(transactionAmountField());
        waitForVisible(productDescriptionField(), ConfigReader.getActionTimeout());
        String productDescription = inputValue(productDescriptionField());
        return new TransactionValues(transactionAmount, productDescription);
    }

    private void scrollSearchResultsToTransaction(String transactionNumber) {
        waitForVisible(searchResultsToggle(), ConfigReader.getNavigationTimeout());
        waitForVisible(getByRole(AriaRole.HEADING, "Search Results", true),
                ConfigReader.getNavigationTimeout());
        waitForAttached(searchResultsTable(), ConfigReader.getNavigationTimeout());

        Locator result = getByRole(AriaRole.LINK, transactionNumber, true);
        for (int attempt = 0; attempt < 12 && !result.isVisible(); attempt++) {
            scrollWithMouseWheel(searchResultsTable(), 2500);
        }

        waitForVisible(result, ConfigReader.getNavigationTimeout());
    }

    /** Opens one exact result and returns all labeled detail controls rendered for it. */
    @SuppressWarnings("unchecked")
    public List<TransactionDetail> readTransactionDetails(String transactionNumber) {
        scrollSearchResultsToTransaction(transactionNumber);
        Locator result = getByRole(AriaRole.LINK, transactionNumber, true);
        scrollIntoView(result);
        click(result);
        waitForVisible(getByRole(AriaRole.HEADING, "Edit Transaction: " + transactionNumber, true),
                ConfigReader.getNavigationTimeout());

        Object rawDetails = evaluateJavaScript("""
                () => Array.from(document.querySelectorAll('input, textarea, select'))
                    .filter(control => control.type !== 'hidden')
                    .map(control => {
                    const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
                    const isInternal = value => /^_FOpt\\d+|^_FOr\\d+|^_afr|^j_id|^org\\.apache\\.myfaces|^javax\\.faces/.test(clean(value));
                    const isGeneratedCalendarLabel = value => /^Press down arrow to access Calendar$/i.test(clean(value));
                    const isDateValue = value => /^\\d{1,4}[/-]\\d{1,4}[/-]\\d{2,4}$/.test(clean(value));
                    const associatedLabel = control.id
                        ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.innerText
                        : '';
                    const cellLabel = control.closest('td')?.innerText
                        ?.split('\\n')
                        .map(clean)
                        .find(value => value && value !== clean(control.value)
                            && !isInternal(value) && !isGeneratedCalendarLabel(value)
                            && !isDateValue(value));
                    const ariaLabel = control.getAttribute('aria-label');
                    const label = [
                        cellLabel,
                        associatedLabel,
                        ariaLabel,
                        control.getAttribute('title'),
                        control.getAttribute('placeholder'),
                        control.getAttribute('name')
                    ].map(clean).find(value => value && !isInternal(value)
                        && !isGeneratedCalendarLabel(value))
                        || (isGeneratedCalendarLabel(ariaLabel) ? 'Event Date' : 'Unnamed field');
                    const value = control.tagName === 'SELECT'
                        ? Array.from(control.selectedOptions).map(option => option.text).join(', ')
                        : control.value;
                    return { label, value: clean(value) };
                                }).filter(detail => detail.label && detail.label !== 'Unnamed field')
                """);
        List<TransactionDetail> details = new ArrayList<>();
        for (Map<String, Object> detail : (List<Map<String, Object>>) rawDetails) {
            details.add(new TransactionDetail(transactionNumber,
                    String.valueOf(detail.get("label")),
                    String.valueOf(detail.get("value"))));
        }
        return details;
    }

    public record TransactionDetail(String transactionNumber, String field, String value) {
    }

    public record TransactionValues(String transactionAmount, String productDescription) {
    }
}
