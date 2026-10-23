# Oracle OIC Playwright Automation Framework

Java, TestNG, and Playwright framework for Oracle Incentive Compensation UI automation.

## Layout

- `src/main/java/com/oracle/oic/base`: reusable browser and page-object support.
- `src/main/java/com/oracle/oic/pages`: Login, Home navigation, and Transactions workflows.
- `src/main/java/com/oracle/oic/utils`: configuration, Excel data access, and Extent reporting.
- `src/test/java/com/oracle/oic/base`: TestNG lifecycle and failure evidence.
- `src/test/java/com/oracle/oic/tests`: scenario tests that compose page objects.
- `src/test/resources/config`: environment configuration used by tests.
- `src/test/resources/testdata`: approved Excel workbooks used by data-driven tests.
- `src/test/resources/testng.xml`: TestNG suite used by Maven Surefire.

Configuration stays external in `src/test/resources/config/config.properties`; do not commit credentials.

## Test data

`ExcelReader.readRows("OIC_TestData.xlsx", "<sheet>")` reads non-empty worksheet rows as strings. Add an approved workbook and document its columns before connecting a test to it.

## Reports

Extent reports are written to `test-results/extent/ExtentReport.html`; failure screenshots are written to `test-results/screenshots/`.
