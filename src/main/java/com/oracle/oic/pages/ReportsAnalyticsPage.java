package com.oracle.oic.pages;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.pages.silvus.SilvusCatalogPage;
import com.oracle.oic.utils.ConfigReader;

/** Reports and Analytics page for the workbook staging-table workflow. */
public class ReportsAnalyticsPage extends BasePage {

    public ReportsAnalyticsPage(Page page) {
        super(page);
    }

    private com.microsoft.playwright.Locator pageHeading() {
        return getByRole(AriaRole.HEADING, "Reports and Analytics", true);
    }

    private com.microsoft.playwright.Locator browseCatalogButton() {
        return getByRole(AriaRole.BUTTON, "Browse Catalog", true);
    }

    public void waitForPage() {
        waitForVisible(pageHeading(), ConfigReader.getNavigationTimeout());
    }

    public CatalogPage openCatalog() {
        Page catalogPage = waitForPopup(() -> click(browseCatalogButton()));
        return new CatalogPage(catalogPage);
    }

    public SilvusCatalogPage openSilvusCatalog() {
        Page catalogPage = waitForPopup(() -> click(browseCatalogButton()));
        return new SilvusCatalogPage(catalogPage);
    }
}