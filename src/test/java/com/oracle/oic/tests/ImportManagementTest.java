package com.oracle.oic.tests;

import java.nio.file.Path;

import org.testng.annotations.Test;

import com.oracle.oic.pages.ImportManagementPage;

/** Verifies the observed CNNNN Import Management submission result. */
public class ImportManagementTest extends com.oracle.oic.base.BaseTest {

    private static final String ACTIVITY_NAME = "CCREC to CNNNN demo import";
    private static final String OBJECT_NAME = "Incentive Transaction";
    private static final Path CSV_FILE = Path.of(
            "test-results/invoiced-java-comparison-detailed-cnnnn.csv");

    @Test(description = "Uploads the CNNNN CSV and verifies the Import Management result")
    public void cnnnnImportCompletesWithExpectedWarnings() {
        var homePage = loginToFusionHome();
        ImportManagementPage importManagementPage = new ImportManagementPage(getPage());

        homePage.openImportManagement();
        importManagementPage.waitForPage();
        importManagementPage.startImportActivity(ACTIVITY_NAME, OBJECT_NAME, CSV_FILE);
        importManagementPage.proceedToReviewAndSubmit();
        importManagementPage.assertCompletedWithWarnings(
                ACTIVITY_NAME, "Completed with errors", "0", "7", "0");
    }
}