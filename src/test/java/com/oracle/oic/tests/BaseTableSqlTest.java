package com.oracle.oic.tests;

import org.testng.annotations.Test;

import com.oracle.oic.pages.DataModelPage;
import com.oracle.oic.tests.support.WorkbookSqlTestSupport;

/** Executes the workbook's base-table SQL count scenario using the verified data-model flow. */
public class BaseTableSqlTest extends WorkbookSqlTestSupport {

    private static final String QUERY_MARKER = "CN_TP_TRANSACTIONS_ALL";
    private static final String SCENARIO = "3.Run the Sql query for base table";

    @Test(description = "Runs the workbook base-table count query")
    public void baseTableCountCanBeViewed() {
    DataModelPage dataModelPage = openDataModelFromWorkbookFlow();
    String query = workbookQuery(SCENARIO, QUERY_MARKER);
    int rows = workbookRowLimit(SCENARIO, "enter values 50");

        dataModelPage.addSqlQuery(query);

        String dataText = dataModelPage.viewDataWithRows(rows);
    assertCountRendered(dataText,
                "The base-table SQL result count was not rendered in the data view.");
        System.out.println("Base table result:\n" + dataText);
    }
}