package com.oracle.oic.tests;

import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;

/**
 * Verifies the Oracle Fusion sign-in flow for the Incentive Compensation
 * tenant.
 *
 * Workflow and locator evidence: live Playwright inspection on 2026-08-15
 * confirmed that FuseWelcome redirects to the Oracle Identity Cloud Service
 * combined sign-in page (/ui/v1/signin). The credentials form exposes role
 * textbox "Username" and "Password"; the submit control is button "Next"
 * (the tenant has no separate "Sign In" button). After submit the browser
 * returns to FuseWelcome, where the global header link "Navigator" is
 * visible once the home page has rendered.
 */
public class LoginTest extends BaseTest {

    @Test(description = "A configured user can sign in and reach the Fusion home page")
    public void configuredUserCanSignIn() {
        var homePage = loginToFusionHome();
        homePage.waitForHomePage();
    }
}
