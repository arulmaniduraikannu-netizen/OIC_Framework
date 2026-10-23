package com.oracle.oic.tests;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.TransactionsPage;
import com.oracle.oic.pages.TransactionsPage.TransactionDetail;
import com.oracle.oic.utils.ExcelReader;
import com.oracle.oic.utils.ExcelVerificationReportWriter;

/** Exports all rendered Manage Transactions fields for the workbook transaction set. */
public class TransactionDetailsExportTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String TRANSACTION_MARKER = "Verify the event date,trx number,attribute value,comments";
    private static final String BUSINESS_UNIT = "VSA";
    private static final Pattern TRANSACTION_PATTERN = Pattern.compile("\\b\\d{5,}(?:-[RC]0)?\\b");

    @Test(description = "Exports complete details for each workbook transaction")
    public void transactionDetailsArePrintedToExcel() throws Exception {
        var homePage = loginToFusionHome();
        homePage.openManageTransactions();

        TransactionsPage transactionsPage = new TransactionsPage(getPage());
        List<TransactionDetail> details = new ArrayList<>();
        for (String transactionNumber : readTransactionNumbers()) {
            transactionsPage.searchTransaction(transactionNumber, BUSINESS_UNIT);
            details.addAll(transactionsPage.readTransactionDetails(transactionNumber));
            transactionsPage.cancelTransactionEdit();
        }

        Path report = ExcelVerificationReportWriter.writeTransactionDetails(details,
                Paths.get("test-results/downloads/Transaction_Details.xlsx"));
        Assert.assertFalse(details.isEmpty(), "No transaction details were rendered for export.");
        System.out.println("Transaction details report: " + report);
    }

    private List<String> readTransactionNumbers() {
        List<String> transactionNumbers = new ArrayList<>();
        boolean scenarioFound = false;
        for (Object[] row : ExcelReader.readRows(WORKBOOK, SHEET)) {
            for (Object value : row) {
                if (value == null) {
                    continue;
                }
                String text = value.toString();
                if (text.contains(TRANSACTION_MARKER)) {
                    scenarioFound = true;
                    continue;
                }
                if (scenarioFound) {
                    Matcher matcher = TRANSACTION_PATTERN.matcher(text);
                    while (matcher.find() && !transactionNumbers.contains(matcher.group())) {
                        transactionNumbers.add(matcher.group());
                    }
                }
            }
        }
        if (transactionNumbers.isEmpty()) {
            throw new IllegalArgumentException("No transaction numbers found in workbook scenario.");
        }
        return transactionNumbers;
    }
}