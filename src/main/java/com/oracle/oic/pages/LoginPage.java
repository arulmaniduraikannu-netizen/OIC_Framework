package com.oracle.oic.pages;

import java.util.regex.Pattern;

import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.AriaRole;
import com.microsoft.playwright.options.WaitForSelectorState;
import com.oracle.oic.base.BasePage;
import com.oracle.oic.utils.ConfigReader;

/**
 * Page object for the Oracle Fusion sign-in screen.
 *
 * Uses semantic role and placeholder locators so Playwright can auto-wait for
 * the controls. Credentials are supplied by the caller and are never stored
 * in this page object.
 */
public class LoginPage extends BasePage {

    private static final Pattern FUSION_HOME_URL =
            Pattern.compile(".*/fscmUI/faces/FuseWelcome.*");
    private static final Pattern SIGN_IN_URL =
            Pattern.compile(".*/signin.*");

    public LoginPage(Page page) {
        super(page);
    }

    private Locator usernameField() {
        return getByRole(AriaRole.TEXTBOX, "Username", true)
                .or(getByPlaceholder("Username", true));
    }

    private Locator passwordField() {
        return getByRole(AriaRole.TEXTBOX, "Password", true)
                .or(getByPlaceholder("Password", true));
    }

    private Locator continueButton() {
        return getByRole(AriaRole.BUTTON, "Next", true);
    }

    /**
     * Waits for the configured Fusion URL to redirect to this tenant's
     * sign-in page. If the redirect has already completed, it continues
     * without waiting for a second navigation.
     */
    public void waitForSignInPage() {
        if (!isCurrentUrlMatching(SIGN_IN_URL)) {
            waitForURL(
                    SIGN_IN_URL,
                    ConfigReader.getNavigationTimeout());
        }
    }

    /**
     * Enters the supplied Oracle credentials and submits the sign-in form.
     * Playwright's locator actions provide the required auto-waiting; no hard
     * waits are used.
     */
    public void login(String username, String password) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("Username cannot be blank.");
        }
        if (password == null || password.isBlank()) {
            throw new IllegalArgumentException("Password cannot be blank.");
        }

        waitForSignInPage();
        usernameField().waitFor(
                new Locator.WaitForOptions()
                        .setState(WaitForSelectorState.VISIBLE)
                        .setTimeout(ConfigReader.getNavigationTimeout()));
        assertVisible(usernameField());
        fill(usernameField(), username);

        assertVisible(passwordField());
        fill(passwordField(), password);

        assertVisible(continueButton());
        click(continueButton());
    }

    /** Waits until Oracle Fusion redirects to its application home page. */
    public void waitForFusionHomePage() {
        waitForFusionHomePage(ConfigReader.getNavigationTimeout());
    }

    /** Waits for a potentially slow interactive SSO handoff to reach Fusion. */
    public void waitForFusionHomePage(double timeout) {
        if (!isCurrentUrlMatching(FUSION_HOME_URL)) {
            waitForURL(
                    FUSION_HOME_URL,
                    timeout);
        }
    }
}
