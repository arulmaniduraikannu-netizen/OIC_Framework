package com.oracle.oic.pages;

import com.microsoft.playwright.FrameLocator;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/**
 * Data Model editor for the workbook staging-table SQL workflow.
 *
 * All locators use BasePage frame helpers (frameGetByRole, frameGetByLabel,
 * frameGetByText, frameQuery) so no raw FrameLocator API leaks out.
 *
 * Locator evidence: live Phase 2 snapshot 2026-09-04 for the Reports and
 * Analytics -> Browse Catalog -> Create -> Data Model -> SQL Query flow.
 */
public class DataModelPage extends BasePage {

    public DataModelPage(Page page) {
        super(page);
    }

    /* iframe name is dynamically generated; prefix match is the only stable selector */
    private FrameLocator editorFrame() {
        return frameLocator("iframe[name^='generalObjectEditor']");
    }

    private Locator datasetNameField() {
        return frameGetByLabel(editorFrame(), "* Name", true)
                .or(frameQuery(editorFrame(), "input[id$='_sql_data_set_name']"));
    }

    private Locator datasetSourceSelect() {
        return frameGetByLabel(editorFrame(), "* Data Source", true)
                .or(frameQuery(editorFrame(), "select[id$='_sql_data_source_select']"));
    }

    private Locator sqlQueryField() {
        return frameGetByLabel(editorFrame(), "* SQL Query", true)
                .or(frameQuery(editorFrame(), "textarea[id^='ds_sql_query_']"));
    }

    private Locator sqlOkButton() {
        return frameGetByRole(editorFrame(), AriaRole.BUTTON, "OK", true)
                .or(frameQuery(editorFrame(), "button[id$='_sql_saveButton']"));
    }

    private Locator rowsSelect() {
        return frameGetByLabel(editorFrame(), "Rows", true)
                .or(frameQuery(editorFrame(), "select[id='_xnum']"));
    }

    private Locator viewButton() {
        return frameGetByRole(editorFrame(), AriaRole.BUTTON, "View", true)
                .or(frameQuery(editorFrame(), "button#getXMLButton"));
    }

    private Locator countResult() {
        return frameGetByText(editorFrame(), "COUNT___ (", false);
    }

    private Locator sqlQueryLink() {
        return frameGetByRole(editorFrame(), AriaRole.LINK, "SQL Query", true);
    }

    private Locator datasetTreeItem(String dataSetName) {
        return frameGetByRole(editorFrame(), AriaRole.TREEITEM, dataSetName, true);
    }

    public void waitForEditor() {
        waitForLoadState(LoadState.DOMCONTENTLOADED);
        waitForVisible(frameGetByRole(editorFrame(), AriaRole.LINK, "New Data SetNew Data Set", true),
                ConfigReader.getNavigationTimeout());
    }

    public void addSqlQuery(String query) {
        click(frameGetByRole(editorFrame(), AriaRole.LINK, "New Data SetNew Data Set", true));
        waitForVisible(sqlQueryLink(), ConfigReader.getNavigationTimeout());
        click(sqlQueryLink());
        waitForVisible(datasetNameField(), ConfigReader.getNavigationTimeout());
        fill(datasetNameField(), "StagingTransactionCount");
        waitForOption(datasetSourceSelect(), "ApplicationDB_FSCM");
        selectOptionByLabel(datasetSourceSelect(), "ApplicationDB_FSCM");
        fill(sqlQueryField(), query);
        click(sqlOkButton());
        waitForVisible(datasetTreeItem("StagingTransactionCount"),
                ConfigReader.getNavigationTimeout());
    }

    public String viewDataWithRows(int rows) {
        click(frameGetByRole(editorFrame(), AriaRole.LINK, "Data", true));
        String rowLimit = Integer.toString(rows);
        waitForVisible(rowsSelect(), ConfigReader.getNavigationTimeout());
        waitForOption(rowsSelect(), rowLimit);
        selectOptionByLabel(rowsSelect(), rowLimit);
        click(viewButton());
        waitForVisible(countResult(), ConfigReader.getNavigationTimeout());
        return countResult().innerText();
    }
}