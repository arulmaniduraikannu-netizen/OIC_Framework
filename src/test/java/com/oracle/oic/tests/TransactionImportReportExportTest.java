package com.oracle.oic.tests;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipFile;

import org.testng.Assert;
import org.testng.annotations.Test;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.pages.TransactionImportReportPage;
import com.oracle.oic.utils.ExcelReader;
import com.oracle.oic.utils.InvoicedWorkbookComparator;

/** Exports and validates each month in scenario 10 using its observed BI Publisher report flow. */
public class TransactionImportReportExportTest extends BaseTest {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
        private static final String PERIOD_SHEET = "ReportPeriods";
        private static final List<String> PERIOD_HEADERS = List.of(
            "Month", "RegularFrom", "RegularTo", "Split1From", "Split1To", "Split2From", "Split2To");
        private static final DateTimeFormatter WORKBOOK_DATE = DateTimeFormatter.ofPattern("M/d/yy");
    private static final DateTimeFormatter REPORT_DATE =
            DateTimeFormatter.ofPattern("MM-dd-yyyy", Locale.ENGLISH);
    private static final List<String> EXPECTED_MONTHS = List.of(
            "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec");

    @Test(description = "Downloads and validates all monthly Transaction Import Reports")
    public void monthlyTransactionImportReportsDownloadAsValidWorkbooks() throws IOException {
        List<ReportPeriod> periods = readReportPeriods();
        Path downloadDirectory = Paths.get("test-results/downloads").toAbsolutePath();
        Files.createDirectories(downloadDirectory);

        var homePage = loginToFusionHome();
        var reportTab = homePage.openTransactionImportReport();
        trackEvidencePage(reportTab);
        TransactionImportReportPage reportPage = new TransactionImportReportPage(reportTab);
        reportPage.waitForReportPage();

        List<String> skippedMonths = new ArrayList<>();
        for (ReportPeriod period : periods) {
            Path regularReport = downloadDirectory.resolve(period.month() + ".xlsx");
            try {
                exportAndValidate(reportPage, period.regularRange(), regularReport);
                System.out.println("Verified Transaction Import Report: " + regularReport);
                continue;
            } catch (TransactionImportReportPage.ReportSizeLimitException sizeLimit) {
                System.out.println("BI Publisher size limit for " + period.month()
                        + "; trying configured split ranges.");
            }

            if (period.split1() == null) {
                skippedMonths.add(period.month() + " (no split ranges configured)");
                continue;
            }

            List<DateRange> splitRanges = List.of(period.split1(), period.split2());
            boolean splitReportsValid = true;
            for (int index = 0; index < splitRanges.size(); index++) {
                Path splitReport = downloadDirectory.resolve(
                        period.month() + "-part" + (index + 1) + ".xlsx");
                try {
                    exportAndValidate(reportPage, splitRanges.get(index), splitReport);
                    System.out.println("Verified Transaction Import Report part: " + splitReport);
                } catch (TransactionImportReportPage.ReportSizeLimitException sizeLimit) {
                    skippedMonths.add(period.month() + " (split part " + (index + 1)
                            + " also exceeded the BI Publisher size limit)");
                    splitReportsValid = false;
                    break;
                }
            }
            if (!splitReportsValid) {
                continue;
            }
        }
        Assert.assertTrue(skippedMonths.isEmpty(),
                "Some monthly reports could not be exported: " + String.join(", ", skippedMonths));

        Path comparisonReport = generateComparisonReport(downloadDirectory);
        assertCombinedComparisonReport(comparisonReport);
    }

    private List<ReportPeriod> readReportPeriods() {
        List<ReportPeriod> periods = new ArrayList<>();
        Object[][] rows = ExcelReader.readRows(WORKBOOK, PERIOD_SHEET);
        Assert.assertTrue(rows.length > 1, "ReportPeriods must contain headers and month rows.");
        List<String> headers = Arrays.stream(rows[0]).map(Object::toString).toList();
        Assert.assertEquals(headers, PERIOD_HEADERS, "Unexpected ReportPeriods column headers.");

        for (int rowIndex = 1; rowIndex < rows.length; rowIndex++) {
            Object[] row = rows[rowIndex];
            String month = cell(row, 0).toLowerCase(Locale.ROOT);
            DateRange regularRange = requiredRange(month, cell(row, 1), cell(row, 2));
            DateRange split1 = optionalRange(month, "Split1", cell(row, 3), cell(row, 4));
            DateRange split2 = optionalRange(month, "Split2", cell(row, 5), cell(row, 6));
            validateSplits(month, regularRange, split1, split2);
            periods.add(new ReportPeriod(month, regularRange, split1, split2));
        }
        List<String> actualMonths = periods.stream().map(ReportPeriod::month).toList();
        Assert.assertEquals(actualMonths, EXPECTED_MONTHS,
                "ReportPeriods must contain one ordered regular range for each month.");
        return periods;
    }

    private String cell(Object[] row, int column) {
        return row.length > column && row[column] != null ? row[column].toString().trim() : "";
    }

    private DateRange requiredRange(String month, String from, String to) {
        DateRange range = optionalRange(month, "Regular", from, to);
        if (range == null) {
            throw new IllegalArgumentException("Regular date range is required for " + month);
        }
        return range;
    }

    private DateRange optionalRange(String month, String label, String from, String to) {
        if (from.isBlank() && to.isBlank()) {
            return null;
        }
        if (from.isBlank() || to.isBlank()) {
            throw new IllegalArgumentException(label + " range must have both dates for " + month);
        }
        try {
            DateRange range = new DateRange(LocalDate.parse(from, WORKBOOK_DATE),
                    LocalDate.parse(to, WORKBOOK_DATE));
            if (range.fromDate().isAfter(range.toDate())) {
                throw new IllegalArgumentException(label + " start date is after end date for " + month);
            }
            return range;
        } catch (DateTimeParseException exception) {
            throw new IllegalArgumentException("Invalid " + label + " date range for " + month, exception);
        }
    }

    private void validateSplits(String month, DateRange regular, DateRange split1, DateRange split2) {
        if ((split1 == null) != (split2 == null)) {
            throw new IllegalArgumentException("Both split ranges must be configured for " + month);
        }
        if (split1 != null && (!split1.fromDate().equals(regular.fromDate())
                || !split1.toDate().plusDays(1).equals(split2.fromDate())
                || !split2.toDate().equals(regular.toDate()))) {
            throw new IllegalArgumentException(
                    "Split ranges must exactly and contiguously cover the regular range for " + month);
        }
    }

    private void exportAndValidate(TransactionImportReportPage reportPage, DateRange range, Path report)
            throws IOException {
        Files.deleteIfExists(report);
        reportPage.exportExcel(range.fromDate().format(REPORT_DATE),
                range.toDate().format(REPORT_DATE), report);
        assertValidWorkbook(report);
    }

    private void assertValidWorkbook(Path report) throws IOException {
        Assert.assertTrue(Files.isRegularFile(report), "Report download is missing: " + report);
        Assert.assertTrue(Files.size(report) > 0, "Report download is empty: " + report);
        try (ZipFile workbook = new ZipFile(report.toFile())) {
            Assert.assertTrue(workbook.entries().hasMoreElements(),
                    "Downloaded file is not a populated XLSX archive: " + report);
        }
    }

    private Path generateComparisonReport(Path downloadDirectory) throws IOException {
        Path projectRoot = Paths.get(".").toAbsolutePath().normalize();
        Path invoicedReport = downloadDirectory.resolve("invoiced-java-comparison-extra.xlsx");
        Path bookedReport = downloadDirectory.resolve("booked-java-comparison-extra.xlsx");
        Path combinedReport = Paths.get("test-results/invoiced-booked-java-comparison.xlsx")
                .toAbsolutePath();
        Files.deleteIfExists(invoicedReport);
        Files.deleteIfExists(bookedReport);
        Files.deleteIfExists(combinedReport);

        try {
            InvoicedWorkbookComparator.run(projectRoot, invoicedReport);
            InvoicedWorkbookComparator.runBooked(projectRoot, bookedReport);
            try (Workbook invoiced = WorkbookFactory.create(invoicedReport.toFile());
                    Workbook booked = WorkbookFactory.create(bookedReport.toFile());
                    Workbook combined = new XSSFWorkbook();
                    OutputStream output = Files.newOutputStream(combinedReport)) {
                copySheet(invoiced.getSheetAt(0), combined, "Invoiced Extra Transactions");
                copySheet(booked.getSheetAt(0), combined, "Booked Extra Transactions");
                combined.write(output);
            }
        } finally {
            Files.deleteIfExists(invoicedReport);
            Files.deleteIfExists(bookedReport);
        }
        return combinedReport;
    }

    private void copySheet(Sheet source, Workbook target, String sheetName) {
        Sheet destination = target.createSheet(sheetName);
        for (Row sourceRow : source) {
            Row destinationRow = destination.createRow(sourceRow.getRowNum());
            for (Cell sourceCell : sourceRow) {
                destinationRow.createCell(sourceCell.getColumnIndex())
                        .setCellValue(sourceCell.getStringCellValue());
            }
        }
    }

    private void assertCombinedComparisonReport(Path report) throws IOException {
        assertValidWorkbook(report);
        try (Workbook workbook = WorkbookFactory.create(report.toFile())) {
            Assert.assertEquals(workbook.getNumberOfSheets(), 2,
                    "Comparison report must contain Invoiced and Booked sheets.");
            Assert.assertEquals(workbook.getSheetName(0), "Invoiced Extra Transactions");
            Assert.assertEquals(workbook.getSheetName(1), "Booked Extra Transactions");
        }
    }

    private record DateRange(LocalDate fromDate, LocalDate toDate) {
    }

    private record ReportPeriod(String month, DateRange regularRange, DateRange split1, DateRange split2) {
    }
}