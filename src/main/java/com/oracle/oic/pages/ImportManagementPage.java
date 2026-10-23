package com.oracle.oic.pages;

import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/** Page object for the observed Fusion Import Management upload workflow. */
public class ImportManagementPage extends BasePage {

    private static final long IMPORT_REFRESH_TIMEOUT_NANOS =
            TimeUnit.MINUTES.toNanos(5);
    private static final double REFRESH_STATE_WAIT_MILLIS = 1_000;

    public ImportManagementPage(Page page) {
        super(page);
    }

    private Locator createImportActivityButton() {
        return getByRole(AriaRole.BUTTON, "Create Import Activity", true);
    }

    private Locator nameField() {
        return getByLabel("Name", true);
    }

    private Locator objectField() {
        return getByLabel("Object", true);
    }

    private Locator incentiveTransactionOption() {
        return getByRole(AriaRole.OPTION, "Incentive Transaction", true);
    }

    private Locator fileField() {
        return getByLabel("File Name", true);
    }

    private Locator nextButton() {
        return getByRole(AriaRole.BUTTON, "Next", true);
    }

    private Locator automaticMappingField() {
        return getByRole(AriaRole.COMBOBOX, "Import Mapping", true);
    }

    private Locator submitButton() {
        return getByRole(AriaRole.BUTTON, "Submit", true);
    }

    private Locator manageImportsHeading() {
        return getByRole(AriaRole.HEADING,
                "Manage Imports", true);
    }

    private Locator importResultsTable() {
        return getByRole(AriaRole.TABLE, "Create Import Activity", true);
    }

    private Locator queuedImportsCard() {
        return getByText("Queued Imports", true);
    }

    private Locator refreshButton() {
        return getByRole(AriaRole.LINK, "Refresh", true);
    }

    private Locator queuedImportsCount(String label) {
        Locator labelSpan = getByText(label, true);
        return labelSpan.locator(
                "xpath=../preceding-sibling::div//span[contains(@class, 'AppsLargeFontSize')]");
    }

    private Locator completedImportsExpansionControl() {
        Locator selectedControl = getByRole(
                AriaRole.LINK, "Selected : My Completed Imports", true);
        if (selectedControl.isVisible()) {
            return selectedControl;
        }
        return getByRole(AriaRole.LINK, "Select : My Completed Imports", true);
    }

    private Locator matchingCompletedRow(String activityName, String expectedStatus) {
        return importResultsTable()
            .locator("tbody > tr")
                .filter(new Locator.FilterOptions().setHasText(activityName))
                .filter(new Locator.FilterOptions().setHasText(expectedStatus))
                .first();
    }

    private Locator importStatusHeading(String activityName) {
        return getByRole(
                AriaRole.HEADING,
                "Import Status : " + activityName,
                true);
    }

    public void waitForPage() {
        waitForVisible(createImportActivityButton(), ConfigReader.getNavigationTimeout());
    }

    public void startImportActivity(String activityName, String objectName, Path csvFile) {
        click(createImportActivityButton());
        waitForVisible(nameField(), ConfigReader.getNavigationTimeout());
        fill(nameField(), activityName);
        click(objectField());
        fill(objectField(), "");
        type(objectField(), objectName);
        waitForVisible(incentiveTransactionOption(), ConfigReader.getActionTimeout());
        click(incentiveTransactionOption());
        waitForEnabled(fileField(), ConfigReader.getActionTimeout());
        uploadFile(fileField(), csvFile.toString());
    }

    public void proceedToReviewAndSubmit() {
        click(nextButton());
        waitForVisible(automaticMappingField(), ConfigReader.getNavigationTimeout());
        click(nextButton());
        waitForVisible(submitButton(), ConfigReader.getNavigationTimeout());
        click(submitButton());
        waitForVisible(manageImportsHeading(), ConfigReader.getNavigationTimeout());
    }

    public void assertCompletedWithWarnings(
            String activityName,
            String expectedStatus,
            String expectedErrors,
            String expectedWarnings,
            String expectedUnprocessed) {
        waitForVisible(queuedImportsCard(), ConfigReader.getNavigationTimeout());
            Locator submittedImportsCount = queuedImportsCount("Submitted Imports");
            Locator inProgressCount = queuedImportsCount("In Progress");
            waitForVisible(submittedImportsCount, ConfigReader.getActionTimeout());
            waitForVisible(inProgressCount, ConfigReader.getActionTimeout());

        long refreshDeadline = System.nanoTime() + IMPORT_REFRESH_TIMEOUT_NANOS;
        while (System.nanoTime() < refreshDeadline) {
            String submittedImports = innerText(submittedImportsCount).trim();
            String inProgress = innerText(inProgressCount).trim();
            if ("0".equals(submittedImports)
                    && "0".equals(inProgress)) {
                break;
            }
            click(refreshButton());
            try {
                Locator changingCount = "0".equals(submittedImports)
                        ? inProgressCount
                        : submittedImportsCount;
                String previousCount = "0".equals(submittedImports)
                        ? inProgress
                        : submittedImports;
                waitForTextChange(
                        changingCount,
                        previousCount,
                        REFRESH_STATE_WAIT_MILLIS);
            } catch (AssertionError ignored) {
            }
        }
        assertExactText(
                    submittedImportsCount,
                "0",
                ConfigReader.getNavigationTimeout());
        assertExactText(
                    inProgressCount,
                "0",
                ConfigReader.getNavigationTimeout());

        click(completedImportsExpansionControl());
        waitForVisible(importResultsTable(), ConfigReader.getNavigationTimeout());

        Locator matchingRow = matchingCompletedRow(activityName, expectedStatus);
        waitForVisible(matchingRow, ConfigReader.getNavigationTimeout());
        Locator activityLink = getByRole(
                importResultsTable(),
                AriaRole.LINK,
                activityName,
                true)
                .first();
        waitForVisible(activityLink, ConfigReader.getNavigationTimeout());
        clickForce(activityLink);

        Locator statusSection = importStatusHeading(activityName).locator("..")
                .locator("..");
        waitForVisible(
            importStatusHeading(activityName),
            ConfigReader.getNavigationTimeout());
        assertText(statusSection, expectedStatus);
        assertText(statusSection, expectedErrors + " Errors");
        assertText(statusSection, expectedWarnings + " Warnings");
        assertText(statusSection, expectedUnprocessed + " Unprocessed");
    }
}