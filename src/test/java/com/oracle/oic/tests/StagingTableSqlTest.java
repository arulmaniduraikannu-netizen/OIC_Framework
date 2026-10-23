package com.oracle.oic.tests;

import org.testng.annotations.Test;

import com.oracle.oic.pages.DataModelPage;
import com.oracle.oic.tests.support.WorkbookSqlTestSupport;

/** Executes the SQL-query branch defined in the UCM workbook. */
public class StagingTableSqlTest extends WorkbookSqlTestSupport {

    private static final String SCENARIO = "2.Run the Sql query for staging table";

    @Test(description = "Runs the workbook staging-table count query")
    public void stagingTableCountCanBeViewed() {
        DataModelPage dataModelPage = openDataModelFromWorkbookFlow();
        String query = workbookQuery(SCENARIO, "enter this query");
        int rows = workbookRowLimit(SCENARIO, "enter values");

        dataModelPage.addSqlQuery(query);

        String dataText = dataModelPage.viewDataWithRows(rows);
        assertCountRendered(dataText,
                "The SQL result count was not rendered in the data view.");
        System.out.println("Staging table result:\n" + dataText);
    }
}