package com.oracle.oic.pages;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import com.microsoft.playwright.Download;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/**
 * Oracle Fusion File Import and Export work area.
 *
 * Replace locator accessible names only after confirming them in the live
 * tenant. This class keeps all UI behavior inside the page object.
 */
public class FileImportExportPage extends BasePage {

    private static final DateTimeFormatter UPLOAD_DATE_FORMAT =
            DateTimeFormatter.ofPattern("M/d/yy h:mm a", Locale.ENGLISH);

    public FileImportExportPage(Page page) {
        super(page);
    }

    private Locator pageHeading() {
        return getByRole(AriaRole.HEADING, "Overview", true);
    }

    private Locator accountDropdown() {
        return getByLabel("Account", true);
    }

    private Locator fileNameField() {
        return getByLabel("File", true);
    }

    private Locator searchButton() {
        return getByRole(AriaRole.BUTTON, "Search", true);
    }

    private Locator fileResultLink(String fileName) {
        return getByRole(AriaRole.LINK, fileName, true);
    }

    /**
     * Confirms that the File Import and Export work area is displayed.
     */
    public void waitForPage() {
        waitForVisible(pageHeading(), ConfigReader.getNavigationTimeout());
    }

    /**
     * Selects the observed Account value from the Account control.
     *
     * Replace this implementation after verifying whether Account is a native
     * select, combobox, or Oracle LOV dialog in the tenant.
     */
    public void selectAccount(String account) {
        waitForVisible(accountDropdown(), ConfigReader.getActionTimeout());
        selectOption(accountDropdown(), account);
    }

    /**
     * Enters a file-name filter. Keep the expected wildcard syntax in test data.
     */
    public void enterFileName(String fileNamePattern) {
        waitForVisible(fileNameField(), ConfigReader.getActionTimeout());
        clear(fileNameField());
        fill(fileNameField(), fileNamePattern);
    }

    /**
     * Runs the current File Import and Export search criteria.
     */
    public void search() {
        waitForVisible(searchButton(), ConfigReader.getActionTimeout());
        click(searchButton());
    }

    /**
     * Verifies that a searched file is present in the results table.
     */
    public boolean isFilePresent(String fileName) {
        Locator matchingLinks = fileResultLink(fileName);
        waitForVisible(matchingLinks.first(), ConfigReader.getNavigationTimeout());

        Locator latestFileLink = null;
        LocalDateTime latestUploadDate = null;
        for (int index = 0; index < matchingLinks.count(); index++) {
            Locator fileLink = matchingLinks.nth(index);
            Locator resultRow = fileLink.locator("xpath=ancestor::tr[1]");
            String uploadDateText = resultRow.getByRole(AriaRole.CELL).nth(2).innerText().trim();
            LocalDateTime uploadDate = LocalDateTime.parse(uploadDateText, UPLOAD_DATE_FORMAT);
            if (latestUploadDate == null || uploadDate.isAfter(latestUploadDate)) {
                latestUploadDate = uploadDate;
                latestFileLink = fileLink;
            }
        }
        return latestFileLink != null && latestFileLink.isVisible();
    }

    /**
     * Downloads the first result-row file.
     *
     * Live evidence (2026-08-15): each result-row file name is a direct
     * download link to the Fusion content repository; clicking it fires the
     * download immediately. There is no separate Download button.
     */
    public Path downloadFile(Path targetPath) {
        Locator matchingFile = fileResultLink(targetPath.getFileName().toString());
        waitForVisible(matchingFile.first(), ConfigReader.getNavigationTimeout());
        Download download = getPage().waitForDownload(() ->
            click(matchingFile.first()));
        download.saveAs(targetPath);
        return targetPath;
    }
}