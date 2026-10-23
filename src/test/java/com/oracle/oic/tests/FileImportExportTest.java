package com.oracle.oic.tests;

import java.util.List;

import org.testng.Assert;
import org.testng.annotations.Optional;
import org.testng.annotations.Parameters;
import org.testng.annotations.Test;

import com.oracle.oic.pages.FileImportExportPage;
import com.oracle.oic.tests.support.WorkbookZipFileSupport;

/**
 * Verifies that an authorized user can search and download a file from
 * Oracle Fusion File Import and Export.
 *
 * Workflow and locator evidence: live inspection on 2026-08-20 confirmed the
 * Account control is a native select and the result file names are direct
 * links. The workbook supplies the expected ZIP file names.
 */
public class FileImportExportTest extends WorkbookZipFileSupport {

         private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
         private static final String SHEET = "Sheet1";
         private static final String SCENARIO = "1.verify the files in UCM server as EDH send";

    @Test(description = "Searches and downloads a file from File Import and Export")
    @Parameters({ "accountName", "fileName" })
    public void fileCanBeSearchedAndDownloaded(
            @Optional("ic/incentiveCompensationTransaction/import") String accountName,
            @Optional("UPDATE_FILE_NAME") String fileName) throws Exception {

        var homePage = loginToFusionHome();
        FileImportExportPage fileImportExportPage =
                new FileImportExportPage(getPage());

        homePage.openFileImportAndExport();
                fileImportExportPage.waitForPage();
                fileImportExportPage.selectAccount(accountName);
        fileImportExportPage.search();

                for (String expectedFileName : readExpectedFileNames()) {
                        Assert.assertTrue(
                                        fileImportExportPage.isFilePresent(expectedFileName),
                                        "Expected file was not found in File Import and Export results: "
                                                        + expectedFileName);
                        System.out.println("Verified file: " + expectedFileName);
                }
    }

        private List<String> readExpectedFileNames() {
                return readWorkbookZipFileNames(
                                WORKBOOK,
                                SHEET,
                                SCENARIO,
                                "No expected ZIP files found in workbook: ");
        }
}