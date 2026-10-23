package com.oracle.oic.base;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.Files;
import java.util.List;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.Tracing;
import com.microsoft.playwright.options.ColorScheme;
import com.oracle.oic.utils.ConfigReader;

/**
 * Central factory responsible for managing the Playwright lifecycle.
 *
 * Responsibilities:
 * <ul>
 *     <li>Create Playwright instance</li>
 *     <li>Launch configured browser</li>
 *     <li>Create BrowserContext</li>
 *     <li>Create Page</li>
 *     <li>Provide ThreadLocal access for parallel execution</li>
 * </ul>
 *
 * NOTE:
 * UI interactions (click, fill, waits, assertions, etc.)
 * belong in BasePage, NOT here.
 */
public final class PlaywrightFactory {

    private static final ThreadLocal<Playwright> PLAYWRIGHT = new ThreadLocal<>();
    private static final ThreadLocal<Browser> BROWSER = new ThreadLocal<>();
    private static final ThreadLocal<BrowserContext> CONTEXT = new ThreadLocal<>();
    private static final ThreadLocal<Page> PAGE = new ThreadLocal<>();

    /**
     * Prevent instantiation.
     */
    private PlaywrightFactory() {
        throw new IllegalStateException("Utility class");
    }

    /**
     * Initializes Playwright, Browser, BrowserContext and Page.
     * Safe to call once per test thread.
     */
    public static void initialize() {

    if (isInitialized()) {
        return;
    }

    Playwright playwright = Playwright.create();
    PLAYWRIGHT.set(playwright);

    Browser browser = launchBrowser(playwright);
    BROWSER.set(browser);

    BrowserContext context = createBrowserContext(browser);
    CONTEXT.set(context);
        context.tracing().start(new Tracing.StartOptions()
            .setScreenshots(true)
            .setSnapshots(true)
            .setSources(true));

    Page page = createPage(context);
    PAGE.set(page);
}

    /**
     * Launch browser according to config.
     */
    private static Browser launchBrowser(Playwright playwright) {

        String browserName = ConfigReader.getBrowser().trim().toLowerCase();
        boolean headless = ConfigReader.isHeadless();

        BrowserType.LaunchOptions options = new BrowserType.LaunchOptions()
            .setHeadless(headless)
            .setSlowMo(ConfigReader.getSlowMo());

        return switch (browserName) {

            case "chromium" ->
                playwright.chromium().launch(options);

            case "chrome" ->
                playwright.chromium()
                    .launch(options.setChannel("chrome"));

            case "msedge", "edge" ->
                playwright.chromium()
                    .launch(options.setChannel("msedge"));

            case "firefox" ->
                playwright.firefox().launch(options);

            case "webkit" ->
                playwright.webkit().launch(options);

            default ->
                throw new IllegalArgumentException(
                    "Unsupported browser : " + browserName);
        };
    }

    /**
     * Returns current Playwright instance.
     */
    public static Playwright getPlaywright() {
        return PLAYWRIGHT.get();
    }

    /**
     * Returns current Browser.
     */
    public static Browser getBrowser() {
        return BROWSER.get();
    }

    /**
     * Returns current BrowserContext.
     */
    public static BrowserContext getContext() {
        return CONTEXT.get();
    }

    /**
     * Returns current Page.
     */
    public static Page getPage() {
        return PAGE.get();
    }

    /**
     * Returns true if current thread already has
     * initialized Playwright objects.
     */
    public static boolean isInitialized() {

        return PLAYWRIGHT.get() != null
                && BROWSER.get() != null
                && CONTEXT.get() != null
                && PAGE.get() != null;
    }
/**
 * Creates a configured BrowserContext.
 */
private static BrowserContext createBrowserContext(Browser browser) {

    Browser.NewContextOptions options = createContextOptions();

    return browser.newContext(options);
}

/**
 * Creates BrowserContext options using framework configuration.
 */
private static Browser.NewContextOptions createContextOptions() {

    Browser.NewContextOptions options = new Browser.NewContextOptions();

    String storageState = System.getenv("OIC_STORAGE_STATE");
    if (storageState != null) {
        String trimmedStorageState = storageState.trim();
        if (!trimmedStorageState.isBlank()) {
            Path storageStatePath = Paths.get(trimmedStorageState);
            if (!Files.isRegularFile(storageStatePath)) {
                throw new IllegalArgumentException(
                        "OIC_STORAGE_STATE does not point to a readable file: "
                                + storageStatePath.toAbsolutePath());
            }
            options.setStorageStatePath(storageStatePath);
        }
    }

    // Viewport
    options.setViewportSize(
            ConfigReader.getViewportWidth(),
            ConfigReader.getViewportHeight());

    // Downloads
    options.setAcceptDownloads(
            ConfigReader.isAcceptDownloads());

    // HTTPS
    options.setIgnoreHTTPSErrors(
            ConfigReader.isIgnoreHttpsErrors());

    // JavaScript
    options.setJavaScriptEnabled(
            ConfigReader.isJavaScriptEnabled());

    // Locale
    options.setLocale(
            ConfigReader.getLocale());

    // Color Scheme
    options.setColorScheme(ColorScheme.LIGHT);

    // Optional video recording
    if (ConfigReader.isRecordVideo()) {

        options.setRecordVideoDir(
                Paths.get("test-results/videos"));

        options.setRecordVideoSize(
                ConfigReader.getViewportWidth(),
                ConfigReader.getViewportHeight());
    }

    return options;
}

/**
 * Creates a new Playwright page.
 */
private static Page createPage(BrowserContext context) {

    Page page = context.newPage();

    configureTimeouts(page);

    return page;
}

/**
 * Configures default framework timeouts.
 */
private static void configureTimeouts(Page page) {

    page.setDefaultTimeout(
            ConfigReader.getActionTimeout());

    page.setDefaultNavigationTimeout(
            ConfigReader.getNavigationTimeout());
}

/**
 * Creates a new browser tab/page
 *
 * @return newly created Page
 */
public static Page newPage() {

    BrowserContext context = getContext();

    if (context == null) {
        throw new IllegalStateException(
                "Browser context is not initialized.");
    }

    Page newPage = context.newPage();

    configureTimeouts(newPage);

    return newPage;
}


/**
 * Returns all currently opened pages/tabs.
 */
public static List<Page> getAllPages() {

    BrowserContext context = getContext();

    if (context == null) {
        throw new IllegalStateException(
                "Browser context is not initialized.");
    }

    return context.pages();
}


/**
 * Returns number of opened tabs.
 */
public static int getPageCount() {

    return getAllPages().size();
}


/**
 * Switches to a tab using index.
 *
 * Example:
 *
 * switchToPage(1);
 *
 * switches to second tab.
 */
public static Page switchToPage(int index) {

    List<Page> pages = getAllPages();

    if (index < 0 || index >= pages.size()) {

        throw new IllegalArgumentException(
                "Invalid page index : " + index
                + ". Available pages : "
                + pages.size());
    }

    Page selectedPage = pages.get(index);

    PAGE.set(selectedPage);

    return selectedPage;
}


/**
 * Switches to the latest opened tab.
 *
 * Useful after opening reports/popups.
 */
public static Page switchToLastPage() {

    List<Page> pages = getAllPages();

    if (pages.isEmpty()) {

        throw new IllegalStateException(
                "No pages available.");
    }

    Page lastPage =
            pages.get(pages.size() - 1);

    PAGE.set(lastPage);

    return lastPage;
}


/**
 * Returns currently active page.
 */
public static Page getCurrentPage() {

    Page currentPage = PAGE.get();

    if (currentPage == null) {

        throw new IllegalStateException(
                "No active page available.");
    }

    return currentPage;
}


/**
 * Closes current active page.
 */
public static void closePage() {

    Page page = PAGE.get();

    if (page != null) {

        try {

            page.close();

        } catch (Exception e) {

            System.err.println(
                    "Failed to close page: "
                            + e.getMessage());
        }

        PAGE.remove();
    }
}


/**
 * Closes current browser context.
 */
public static void closeContext() {

    BrowserContext context = CONTEXT.get();

    if (context != null) {

        try {

            context.close();

        } catch (Exception e) {

            System.err.println(
                    "Failed to close context: "
                            + e.getMessage());
        }

        CONTEXT.remove();
    }
}


/**
 * Closes browser instance.
 */
public static void closeBrowser() {

    Browser browser = BROWSER.get();

    if (browser != null) {

        try {

            browser.close();

        } catch (Exception e) {

            System.err.println(
                    "Failed to close browser: "
                            + e.getMessage());
        }

        BROWSER.remove();
    }
}


/**
 * Closes Playwright instance.
 */
public static void closePlaywright() {

    Playwright playwright = PLAYWRIGHT.get();

    if (playwright != null) {

        try {

            playwright.close();

        } catch (Exception e) {

            System.err.println(
                    "Failed to close Playwright: "
                            + e.getMessage());
        }

        PLAYWRIGHT.remove();
    }
}


/**
 * Complete cleanup method.
 *
 * This should be called after every test.
 */
public static void shutdown() {

    closePage();

    closeContext();

    closeBrowser();

    closePlaywright();
}

}