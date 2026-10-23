package com.oracle.oic.base;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.testng.ITestResult;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

import com.microsoft.playwright.Page;
import com.microsoft.playwright.Tracing;
import com.oracle.oic.pages.HomePage;
import com.oracle.oic.pages.LoginPage;
import com.oracle.oic.utils.ConfigReader;
import com.oracle.oic.utils.ExtentReportManager;

/**
 * Test lifecycle base class: initializes an isolated browser, navigates to
 * the configured tenant, captures failure evidence, and closes resources.
 */
public abstract class BaseTest {

    protected Page page;
    private Page evidencePage;

    @BeforeMethod(alwaysRun = true)
    public void setUp(ITestResult result) {
        ExtentReportManager.startTest(result.getMethod().getMethodName());
        ExtentReportManager.info("Test started: " + result.getMethod().getMethodName());
        PlaywrightFactory.initialize();
        page = PlaywrightFactory.getPage();
        evidencePage = page;
        navigateToApplication();
        ExtentReportManager.info("Navigated to the configured Fusion application.");
    }

    @AfterMethod(alwaysRun = true)
    public void tearDown(ITestResult result) {
        try {
            captureTrace(result);
            Path screenshotPath = captureScreenshot(result.getName(), result.getStartMillis());
            if (screenshotPath != null) {
                try {
                    ExtentReportManager.attachScreenshot(screenshotPath);
                } catch (RuntimeException exception) {
                    ExtentReportManager.info("Screenshot attachment failed: "
                            + exception.getMessage());
                }
            }
            if (result.getStatus() == ITestResult.FAILURE) {
                ExtentReportManager.info("Test failed: " + result.getName());
                ExtentReportManager.fail(result.getThrowable());
            } else if (result.getStatus() == ITestResult.SUCCESS) {
                ExtentReportManager.pass("Test passed. The configured purge was not submitted.");
            }
        } finally {
            if (keepBrowserOpenForDebug()) {
                page.pause();
            } else {
                PlaywrightFactory.shutdown();
            }
            ExtentReportManager.flush();
        }
    }

    private void captureTrace(ITestResult result) {
        if (!PlaywrightFactory.isInitialized()) {
            return;
        }
        try {
            if (result.getStatus() == ITestResult.FAILURE) {
                Path tracePath = Paths.get("test-results/traces",
                        result.getName() + "-" + result.getStartMillis() + ".zip").toAbsolutePath();
                Files.createDirectories(tracePath.getParent());
                PlaywrightFactory.getContext().tracing().stop(
                        new Tracing.StopOptions().setPath(tracePath));
                ExtentReportManager.info("Playwright trace: " + tracePath);
            } else {
                PlaywrightFactory.getContext().tracing().stop();
            }
        } catch (Exception exception) {
            System.err.println("Playwright trace capture failed: " + exception.getMessage());
            ExtentReportManager.info("Playwright trace capture failed: " + exception.getMessage());
        }
    }

    private boolean keepBrowserOpenForDebug() {
        return Boolean.parseBoolean(System.getenv("OIC_KEEP_BROWSER_OPEN"));
    }

    protected Page getPage() {
        return page;
    }

    protected void trackEvidencePage(Page pageForEvidence) {
        if (pageForEvidence == null) {
            throw new IllegalArgumentException("Evidence page cannot be null");
        }
        evidencePage = pageForEvidence;
    }

    protected HomePage loginToFusionHome() {
        LoginPage loginPage = new LoginPage(getPage());
        HomePage homePage = new HomePage(getPage());
        if (hasStorageState()) {
            try {
                homePage.waitForHomePage();
            } catch (RuntimeException exception) {
                throw new IllegalStateException(
                        "The storage state is missing, expired, or did not authenticate the configured Fusion tenant.",
                        exception);
            }
            return homePage;
        }
        loginPage.login(ConfigReader.getUsername(), ConfigReader.getPassword());
        homePage.waitForHomePage();
        return homePage;
    }

    private boolean hasStorageState() {
        String storageState = System.getenv("OIC_STORAGE_STATE");
        return storageState != null
                && !storageState.trim().isBlank()
                && Files.isRegularFile(Paths.get(storageState.trim()));
    }

    private void navigateToApplication() {
        String url = ConfigReader.getBaseUrl();
        if (url == null || url.isBlank()) {
            throw new IllegalStateException("Base URL is missing in config.properties");
        }
        page.navigate(url);
    }

        private Path captureScreenshot(String testName, long runId) {
        try {
            Page pageForEvidence = evidencePage != null ? evidencePage : page;
            if (pageForEvidence != null) {
            Path screenshotPath = Paths.get("test-results/screenshots",
                testName + "-" + runId + ".png").toAbsolutePath();
            Files.createDirectories(screenshotPath.getParent());
                pageForEvidence.screenshot(new Page.ScreenshotOptions()
                        .setPath(screenshotPath)
                .setFullPage(false)
                .setTimeout(10_000));
                return screenshotPath;
            }
        } catch (Exception exception) {
            System.err.println("Screenshot capture failed: " + exception.getMessage());
            ExtentReportManager.info("Screenshot capture failed: " + exception.getMessage());
        }
        return null;
    }
}
