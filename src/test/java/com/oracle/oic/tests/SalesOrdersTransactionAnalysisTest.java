package com.oracle.oic.tests;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

import org.testng.annotations.Optional;
import org.testng.annotations.Parameters;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.FileImportExportPage;
import com.oracle.oic.utils.CsvZipReader;

/**
 * Downloads one Sales Orders CSV from Fusion and verifies its transaction count
 * and source-currency amount sum independently of the Copilot runner.
 *
 * Workflow and locator evidence: the existing FileImportExportPage contract
 * records live verification of the Account control, File filter, Search action,
 * and direct result-file download link on 2026-08-20.
 */
public class SalesOrdersTransactionAnalysisTest extends BaseTest {

    private static final String DEFAULT_ACCOUNT = "ic/incentiveCompensationTransaction/import";
    private static final String DEFAULT_FILE_NAME = "OIC_Feed_VSA_Sales_Orders004_20260924064951.csv";
    private static final String TRANSACTION_NUMBER = "transaction number";
    private static final String TRANSACTION_AMOUNT = "transaction amount (source currency)";

    @Test(description = "Downloads Sales Orders and verifies transaction count and amount sum")
    @Parameters({ "accountName", "fileName", "expectedTransactionCount", "expectedAmountSum" })
    public void salesOrdersCountAndAmountCanBeVerified(
            @Optional(DEFAULT_ACCOUNT) String accountName,
            @Optional(DEFAULT_FILE_NAME) String fileName,
            @Optional("23767") String expectedTransactionCount,
            @Optional("108188608.925697") String expectedAmountSum) throws Exception {

        var homePage = loginToFusionHome();
        var fileImportExportPage = new FileImportExportPage(getPage());
        Path downloadPath = Paths.get("test-results", "downloads", fileName).toAbsolutePath();
        Files.createDirectories(downloadPath.getParent());
        Files.deleteIfExists(downloadPath);

        homePage.openFileImportAndExport();
        fileImportExportPage.waitForPage();
        fileImportExportPage.selectAccount(accountName);
        fileImportExportPage.enterFileName(fileName);
        fileImportExportPage.search();
        fileImportExportPage.downloadFile(downloadPath);

        assertTrue(Files.isRegularFile(downloadPath), "Downloaded file was not created: " + downloadPath);

        List<Map<String, String>> records = CsvZipReader.readCsvFile(downloadPath);
        long transactionNumberCount = records.stream()
                .map(record -> record.getOrDefault(TRANSACTION_NUMBER, "").trim())
                .filter(transactionNumber -> !transactionNumber.isEmpty())
                .count();
        BigDecimal amountSum = records.stream()
                .map(record -> record.getOrDefault(TRANSACTION_AMOUNT, "").trim())
                .filter(amount -> !amount.isEmpty())
                .map(BigDecimal::new)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        assertEquals(transactionNumberCount, Long.parseLong(expectedTransactionCount));
        assertEquals(amountSum, new BigDecimal(expectedAmountSum));
    }
}