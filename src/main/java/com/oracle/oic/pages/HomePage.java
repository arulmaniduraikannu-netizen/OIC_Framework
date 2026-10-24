package com.oracle.oic.pages;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/**
 * Oracle Fusion home and Overview navigation.
 *
 * Workflow and locator evidence: Playwright MCP inspection on 2026-08-08
 * verified Navigator, the titled Incentive Compensation group, and the
 * Credits and Earnings link in the expanded menu.
 */
public class HomePage extends BasePage {

    public HomePage(Page page) {
        super(page);
    }

    private Locator navigatorLink() {
        return getByRole(AriaRole.LINK, "Navigator", true);
    }

    private Locator incentiveCompensationNavigatorGroup() {
        return getByTitle("Incentive Compensation", true);
    }

    private Locator expandIncentiveCompensationLink() {
        return getByRole(AriaRole.LINK, "Expand Incentive Compensation", true);
    }

    private Locator collapseIncentiveCompensationLink() {
        return getByRole(AriaRole.LINK, "Collapse Incentive Compensation", true);
    }

    private Locator creditsAndEarningsNavigatorLink() {
        return getByRole(AriaRole.LINK, "Credits and Earnings", true);
    }
    private Locator toolsGroup() {
        return getByRole(AriaRole.LINK, "Expand Tools", true);
    }

    private Locator collapseToolsGroup() {
        return getByRole(AriaRole.LINK, "Collapse Tools", true);
    }

    private Locator navigatorShowMoreLink() {
        return getByRole(AriaRole.LINK, "Show More", true);
    }

    private Locator toolsTab() {
        return getByRole(AriaRole.TAB, "Tools", true);
    }

    private Locator tasksLink() {
        return getByRole(AriaRole.LINK, "Tasks", true);
    }

    private Locator collectTransactionsLink() {
        return getByRole(AriaRole.LINK, "Collect Transactions", true);
    }

    private Locator manageTransactionsLink() {
        return getByRole(AriaRole.LINK, "Manage Transactions", true);
    }

    private Locator manageTransactionsHeading() {
        return getByRole(AriaRole.HEADING, "Manage Transactions", true);
    }

    private Locator participantAssignmentsNavigatorLink() {
        return getByRole(AriaRole.LINK, "Participant Assignments", true);
    }

    private Locator viewProcessesLink() {
        return getByRole(AriaRole.LINK, "View Processes", true);
    }

    private Locator manageScheduledProcessesHeading() {
        return getByRole(AriaRole.HEADING, "Manage Scheduled Processes", true);
    }

private Locator fileImportAndExportLink() {
    return getByText("File Import and Export", true);
}

    private Locator importManagementLink() {
        return getByText("Import Management", true);
    }

    private Locator reportsAndAnalyticsLink() {
        return getByRole(AriaRole.LINK, "Reports and Analytics", true);
    }

    private Locator reportsTabLink() {
        return getByRole(AriaRole.LINK, "Reports", true);
    }

    private Locator transactionImportReportLink() {
        return getByRole(AriaRole.LINK, "Transaction Import Report", true);
    }

    /** Selects the Incentive Compensation navigation group from the home page. */
    public void selectIncentiveCompensation() {
        click(navigatorLink());
        waitForVisible(incentiveCompensationNavigatorGroup(), ConfigReader.getActionTimeout());
        click(incentiveCompensationNavigatorGroup());
    }

    /** Opens the verified Credits and Earnings Manage Transactions task. */
    public void openManageTransactions() {
        click(navigatorLink());
        waitForVisible(incentiveCompensationNavigatorGroup(), ConfigReader.getActionTimeout());
        click(incentiveCompensationNavigatorGroup());
        waitForVisible(creditsAndEarningsNavigatorLink(), ConfigReader.getActionTimeout());
        click(creditsAndEarningsNavigatorLink());
        waitForVisible(tasksLink(), ConfigReader.getNavigationTimeout());
        click(tasksLink());
        waitForVisible(manageTransactionsLink(), ConfigReader.getActionTimeout());
        click(manageTransactionsLink());
        waitForVisible(manageTransactionsHeading(), ConfigReader.getNavigationTimeout());
    }

    /** Opens the verified Credits and Earnings task area. */
    public void openCreditsAndEarnings() {
        click(navigatorLink());
        waitForVisible(expandIncentiveCompensationLink(), ConfigReader.getActionTimeout());
        clickForce(expandIncentiveCompensationLink());
        waitForVisible(creditsAndEarningsNavigatorLink(), ConfigReader.getActionTimeout());
        click(creditsAndEarningsNavigatorLink());
        waitForVisible(tasksLink(), ConfigReader.getNavigationTimeout());
        click(tasksLink());
        waitForVisible(collectTransactionsLink(), ConfigReader.getActionTimeout());
        click(collectTransactionsLink());
    }

    /** Opens the Scheduled Processes work area for job-set execution. */
    public void openScheduledProcesses() {
        if (!navigatorShowMoreLink().isVisible()) {
            click(navigatorLink());
            waitForVisible(navigatorShowMoreLink(), ConfigReader.getActionTimeout());
        }

        if (!collapseToolsGroup().isVisible()) {
            waitForVisible(toolsGroup(), ConfigReader.getActionTimeout());
            clickForce(toolsGroup());
        }
        if (!collapseIncentiveCompensationLink().isVisible()) {
            waitForVisible(expandIncentiveCompensationLink(), ConfigReader.getActionTimeout());
            clickForce(expandIncentiveCompensationLink());
        }
        waitForVisible(participantAssignmentsNavigatorLink(), ConfigReader.getActionTimeout());
        click(participantAssignmentsNavigatorLink());
        waitForVisible(tasksLink(), ConfigReader.getNavigationTimeout());
        click(tasksLink());
        waitForVisible(viewProcessesLink(), ConfigReader.getActionTimeout());
        click(viewProcessesLink());
        waitForVisible(manageScheduledProcessesHeading(), ConfigReader.getNavigationTimeout());
    }

    /** Opens the File Import and Export work area. */
    public void openFileImportAndExport() {
        click(navigatorLink());
        waitForVisible(toolsGroup(), ConfigReader.getActionTimeout());
        clickForce(toolsGroup());
        waitForVisible(fileImportAndExportLink(), ConfigReader.getActionTimeout());
        click(fileImportAndExportLink());
    }

    /** Opens the verified Import Management work area. */
    public void openImportManagement() {
        click(navigatorLink());
        waitForVisible(toolsGroup(), ConfigReader.getActionTimeout());
        clickForce(toolsGroup());
        waitForVisible(importManagementLink(), ConfigReader.getActionTimeout());
        click(importManagementLink());
    }

    /** Opens Reports and Analytics from the verified Tools navigation group. */
    public void openReportsAndAnalytics() {
        if ("dev4".equals(ConfigReader.getProfile())) {
            click(navigatorLink());
            waitForVisible(toolsGroup(), ConfigReader.getActionTimeout());
            clickForce(toolsGroup());
        } else {
            waitForVisible(toolsTab(), ConfigReader.getActionTimeout());
            click(toolsTab());
        }
        waitForVisible(reportsAndAnalyticsLink(), ConfigReader.getActionTimeout());
        click(reportsAndAnalyticsLink());
    }

    /** Opens the Transaction Import Report in the new tab observed from Reports. */
    public Page openTransactionImportReport() {
        click(reportsTabLink());
        waitForVisible(transactionImportReportLink(), ConfigReader.getNavigationTimeout());
        Page reportTab = waitForPopup(() -> click(transactionImportReportLink()));
        reportTab.waitForURL("**/analytics/saw.dll**");
        return reportTab;
    }

    /** Waits until the Fusion home page has rendered after sign-in. */
    public void waitForHomePage() {
        waitForVisible(navigatorLink(), ConfigReader.getNavigationTimeout());
    }
}
