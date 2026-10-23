package com.oracle.oic.pages.silvus;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/** Silvus catalog navigation verified in Dev3 on 2026-09-21. */
public class SilvusCatalogPage extends BasePage {

    public SilvusCatalogPage(Page page) {
        super(page);
    }

    public OtbiReportPage openSilvusReport(String reportName) {
        // The verified catalog tree expands from the disclosure image, not the folder title span.
        var sharedFoldersDisclosure = getByTitle("Shared Folders", true)
            .locator("xpath=preceding-sibling::img[contains(@class, 'treeNodeDisclosure')]");
        click(sharedFoldersDisclosure);

        var custom = getByTitle("Custom", true);
        waitForVisible(custom, ConfigReader.getNavigationTimeout());
        doubleClick(custom);

        var silvus = getByTitle("SILVUS", true);
        waitForVisible(silvus, ConfigReader.getNavigationTimeout());
        doubleClick(silvus);

        var report = getByText(reportName, true);
        waitForVisible(report, ConfigReader.getNavigationTimeout());
        click(report);
        var taskPanel = locator("#idCatalogTasksActionList");
        click(getByRole(taskPanel, AriaRole.LINK, "Open", true));
        return new OtbiReportPage(page);
    }
}