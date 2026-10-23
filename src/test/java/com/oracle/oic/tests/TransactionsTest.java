package com.oracle.oic.tests;

import java.math.BigDecimal;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.TransactionsPage;

/**
 * Verifies the Incentive Compensation transaction measure and dimension.
 *
 * The page-object workflow and its semantic locators were inspected with
 * Playwright MCP on 2026-08-08. Transaction values will be supplied through
 * ExcelReader when an approved OIC_TestData.xlsx schema is available.
 */
public class TransactionsTest extends BaseTest {

    @Test(description = "Verifies the requested transaction measure and dimension")
    public void transactionHasExpectedMeasureAndDimension() {
        var homePage = loginToFusionHome();
        TransactionsPage transactionsPage = new TransactionsPage(getPage());
        homePage.openManageTransactions();
        transactionsPage.searchTransaction("438261", "VSA");

        TransactionsPage.TransactionValues actualValues = transactionsPage.readTransactionValues();

        Assert.assertEquals(
                new BigDecimal(actualValues.transactionAmount().replace(",", "")),
                new BigDecimal("48759.20"),
                "Transaction Amount does not match the expected value.");
        Assert.assertEquals(
                actualValues.productDescription(),
                "Cameras",
                "Product Description does not match the expected value.");
    }
}
