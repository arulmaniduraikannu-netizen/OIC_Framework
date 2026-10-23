package com.oracle.oic.pages;

import java.nio.file.Path;

import com.microsoft.playwright.Download;
import com.microsoft.playwright.FrameLocator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.TimeoutError;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.options.AriaRole;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;
import com.oracle.oic.utils.ExtentReportManager;

/** BI Publisher Transaction Import Report controls observed in the outer report iframe. */
public class TransactionImportReportPage extends BasePage {

    private static final String SIZE_LIMIT_MESSAGE =
            "Report data size exceeds the maximum limit (1073741824 bytes). Stopped processing.";

    public TransactionImportReportPage(Page page) {
        super(page);
    }

    private FrameLocator reportFrame() {
        return frameLocator("iframe");
    }

    private FrameLocator reportResultFrame() {
        return frameLocator(reportFrame(), "iframe[name='xdo:docframe0']");
    }

    private com.microsoft.playwright.Locator fromDateField() {
        return frameGetByRole(reportFrame(), AriaRole.TEXTBOX, "From_Date", true);
    }

    private com.microsoft.playwright.Locator toDateField() {
        return frameGetByRole(reportFrame(), AriaRole.TEXTBOX, "To_Date", true);
    }

    private com.microsoft.playwright.Locator viewReportMenu() {
        return frameQuery(reportFrame(), "[id='xdo:viewFormatLink']");
    }

    private com.microsoft.playwright.Locator excelExportLink() {
        return frameGetByRole(reportFrame(), AriaRole.LINK, "Excel (*.xlsx)", true);
    }

    private Locator sizeLimitMessage() {
        return frameGetByRole(reportResultFrame(), AriaRole.CELL, SIZE_LIMIT_MESSAGE, true);
    }

    private Locator reportCompletedMessage() {
        return frameGetByText(reportResultFrame(), "Report Completed", true);
    }

    private Locator errorDetailLink() {
        return frameGetByRole(reportResultFrame(), AriaRole.LINK, "Error Detail", true);
    }

    public void waitForReportPage() {
        waitForVisible(getByRole(AriaRole.HEADING, "Transaction Report", true),
                ConfigReader.getNavigationTimeout());
        waitForVisible(fromDateField(), ConfigReader.getNavigationTimeout());
    }

    public Path exportExcel(String fromDate, String toDate, Path targetPath) {
        ExtentReportManager.info("Filling Transaction Import Report dates: " + fromDate + " through " + toDate);
        fill(fromDateField(), fromDate);
        fill(toDateField(), toDate);
        ExtentReportManager.info("Opening the View Report format menu with a normal click.");
        click(viewReportMenu());
        var excelOption = excelExportLink();
        waitForVisible(excelOption);
        int excelOptionCount = excelOption.count();
        ExtentReportManager.info("Excel export option match count: " + excelOptionCount);
        if (excelOptionCount != 1) {
            throw new IllegalStateException(
                    "Expected exactly one Excel export option, found " + excelOptionCount);
        }
        assertVisible(excelOption);
        ExtentReportManager.info("View Report menu is open and the Excel option is visible; capturing its state.");
        Path screenshotPath = Path.of("test-results", "screenshots",
            targetPath.getFileName().toString().replace(".xlsx", "-view-report-menu.png"));
        try {
            ExtentReportManager.attachScreenshot(captureScreenshot(screenshotPath));
        } catch (RuntimeException exception) {
            ExtentReportManager.info("Menu screenshot capture failed; continuing export: "
                    + exception.getMessage());
        }
        ExtentReportManager.info("Excel export option is visible; starting the download.");

        Download download;
        try {
            download = downloadFile(() -> {
                click(excelOption);
                waitForVisible(reportCompletedMessage(), ConfigReader.getReportRenderTimeout());
            },
                    ConfigReader.getReportRenderTimeout());
        } catch (TimeoutError timeout) {
            Locator detailLink = errorDetailLink();
            int detailLinkCount = detailLink.count();
            if (detailLinkCount > 1) {
                throw new IllegalStateException(
                        "BI Publisher Error Detail link is ambiguous; found " + detailLinkCount, timeout);
            }
            if (detailLinkCount == 1 && detailLink.isVisible()) {
                click(detailLink);
            } else {
                throw timeout;
            }

            Locator message = sizeLimitMessage();
            try {
                waitForVisible(message, ConfigReader.getActionTimeout());
            } catch (TimeoutError messageTimeout) {
                throw timeout;
            }
            int matchCount = message.count();
            if (matchCount == 1 && message.isVisible()) {
                throw new ReportSizeLimitException(SIZE_LIMIT_MESSAGE, timeout);
            }
            if (matchCount > 1) {
                throw new IllegalStateException(
                        "BI Publisher size-limit message is ambiguous; found " + matchCount, timeout);
            }
            throw timeout;
        }
        saveDownload(download, targetPath.toAbsolutePath().toString());
        ExtentReportManager.info("Excel download saved to " + targetPath.toAbsolutePath());
        return targetPath;
    }

    public static final class ReportSizeLimitException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        private ReportSizeLimitException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}