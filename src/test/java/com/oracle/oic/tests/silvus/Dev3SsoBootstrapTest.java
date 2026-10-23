package com.oracle.oic.tests.silvus;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.testng.annotations.Test;

import com.microsoft.playwright.BrowserContext;
import com.oracle.oic.base.BaseTest;
import com.oracle.oic.base.PlaywrightFactory;
import com.oracle.oic.pages.LoginPage;

/**
 * Opens the configured Dev3 tenant for one interactive SSO/MFA sign-in and
 * saves the resulting browser context for later Silvus tests.
 *
 * Workflow and URL evidence: the existing LoginPage contract observes the
 * Oracle sign-in redirect and the Fusion FuseWelcome URL after authentication.
 * No identity-provider controls are automated or bypassed here.
 */
public class Dev3SsoBootstrapTest extends BaseTest {

    private static final double DEFAULT_INTERACTIVE_SSO_TIMEOUT_MS = 600000;

    @Test(description = "Complete Dev3 SSO interactively and save authenticated browser state")
    public void saveAuthenticatedDev3StorageState() throws Exception {
        System.out.println("Complete Dev3 SSO/MFA in the opened browser window.");

        LoginPage loginPage = new LoginPage(getPage());
        loginPage.waitForFusionHomePage(interactiveSsoTimeoutMs());

        Path storageStatePath = storageStateOutputPath();
        Path parent = storageStatePath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        PlaywrightFactory.getContext().storageState(
                new BrowserContext.StorageStateOptions()
                        .setPath(storageStatePath));
        System.out.println("Saved Dev3 storage state to "
                + storageStatePath.toAbsolutePath());
    }

    private Path storageStateOutputPath() {
        String configuredPath = System.getenv("OIC_STORAGE_STATE_OUTPUT");
        if (configuredPath == null || configuredPath.trim().isBlank()) {
            return Paths.get("test-results/auth/dev3-storage-state.json");
        }
        return Paths.get(configuredPath.trim());
    }

    private double interactiveSsoTimeoutMs() {
        String configuredSeconds = System.getenv("OIC_SSO_TIMEOUT_SECONDS");
        if (configuredSeconds == null || configuredSeconds.trim().isBlank()) {
            return DEFAULT_INTERACTIVE_SSO_TIMEOUT_MS;
        }
        try {
            return Double.parseDouble(configuredSeconds.trim()) * 1000;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException(
                    "OIC_SSO_TIMEOUT_SECONDS must be a number of seconds.",
                    exception);
        }
    }
}