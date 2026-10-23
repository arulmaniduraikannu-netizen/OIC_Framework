package com.oracle.oic.pages;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;

/** Oracle Transactional Business Intelligence Catalog page. */
public class CatalogPage extends BasePage {

    public CatalogPage(Page page) {
        super(page);
    }

    private com.microsoft.playwright.Locator createMenu() {
        return getByRole(AriaRole.BUTTON, "Create drop down menu", true);
    }

    private com.microsoft.playwright.Locator dataModelLink() {
        return getByRole(AriaRole.LINK, "Data Model", true);
    }

    public DataModelPage createDataModel() {
        click(createMenu());
        waitForVisible(dataModelLink(), 10000);
        click(dataModelLink());
        return new DataModelPage(page);
    }
}