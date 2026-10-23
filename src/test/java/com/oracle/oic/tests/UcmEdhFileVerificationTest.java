package com.oracle.oic.tests;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testng.annotations.Test;

import com.oracle.oic.pages.FileImportExportPage;
import com.oracle.oic.tests.support.WorkbookScenarioReader;
import com.oracle.oic.tests.support.WorkbookZipFileSupport;
import com.oracle.oic.utils.CsvZipReader;
import com.oracle.oic.utils.ExcelVerificationReportWriter;
import com.oracle.oic.utils.ValueNormalizer;

/** Verifies EDH-updated UCM CSV data and writes a color-coded Excel report. */
public class UcmEdhFileVerificationTest extends WorkbookZipFileSupport {

    private static final String WORKBOOK = "Verifying _UCM_Server_files.xlsx";
    private static final String SHEET = "Sheet1";
    private static final String SCENARIO = "8.Manually check the file in UCM server whether EDH updated data as asked";
    private static final String ACCOUNT = "ic/incentiveCompensationTransaction/import";
    private static final Pattern TRANSACTION_SUFFIX = Pattern.compile("^(.+)-(R0|C0)$");

    @Test(description = "Verifies EDH-updated values in all downloaded UCM files")
    public void downloadedUcmFilesContainExpectedEdhValues() throws Exception {
        Path downloadDirectory = Paths.get("test-results/downloads");
        Files.createDirectories(downloadDirectory);

        var homePage = loginToFusionHome();
        homePage.openFileImportAndExport();

        FileImportExportPage fileImportExportPage = new FileImportExportPage(getPage());
        fileImportExportPage.waitForPage();
        fileImportExportPage.selectAccount(ACCOUNT);

        Map<String, List<Map<String, String>>> recordsByFile = new LinkedHashMap<>();
        for (String fileName : readExpectedFileNames()) {
            fileImportExportPage.enterFileName(fileName);
            fileImportExportPage.search();
            Path archive = downloadDirectory.resolve(fileName);
            fileImportExportPage.downloadFile(archive);
            recordsByFile.put(fileName, CsvZipReader.readCsv(archive));
        }

        List<Path> reports = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, String>>> file : recordsByFile.entrySet()) {
            Map<String, List<Map<String, String>>> singleFile = new LinkedHashMap<>();
            singleFile.put(file.getKey(), file.getValue());
            List<ExcelVerificationReportWriter.Verification> verifications =
                    compareTransactionPairs(singleFile);
            String reportName = file.getKey().replaceFirst("(?i)\\.zip$", ".xlsx");
            Path report = downloadDirectory.resolve(reportName);
            Files.deleteIfExists(report);
            reports.add(ExcelVerificationReportWriter.write(singleFile, verifications, report));
        }
        reports.forEach(report -> System.out.println("UCM EDH comparison report: " + report));
    }

    private List<String> readExpectedFileNames() {
        String expectedFileNames = null;
        for (Object[] row : WorkbookScenarioReader.scenarioRows(WORKBOOK, SHEET, SCENARIO)) {
            for (Object value : row) {
                if (value != null && value.toString().contains("Expected file names:-")) {
                    expectedFileNames = value.toString();
                }
            }
        }
        if (expectedFileNames == null) {
            throw new IllegalArgumentException(
                    "No expected ZIP filenames found in workbook: " + WORKBOOK);
        }
        return extractZipFileNames(expectedFileNames);
    }

    private List<String> extractZipFileNames(String value) {
        List<String> fileNames = new ArrayList<>();
        java.util.regex.Matcher matcher = java.util.regex.Pattern
            .compile("[A-Za-z0-9][A-Za-z0-9_.-]*\\.zip\\b")
                .matcher(value);
        while (matcher.find() && !fileNames.contains(matcher.group())) {
            fileNames.add(matcher.group());
        }
        return fileNames;
    }

    private List<ExcelVerificationReportWriter.Verification> compareTransactionPairs(
            Map<String, List<Map<String, String>>> recordsByFile) {
        List<ExcelVerificationReportWriter.Verification> results = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, String>>> file : recordsByFile.entrySet()) {
            Map<String, List<Map<String, String>>> pairs = pairRecords(file.getValue());
            if (file.getValue().isEmpty()) {
                results.add(new ExcelVerificationReportWriter.Verification(
                        file.getKey(), "", "CSV payload", "R0/C0 records", "No records", false));
                continue;
            }
            if (pairs.isEmpty()) {
                results.add(new ExcelVerificationReportWriter.Verification(
                        file.getKey(), "", "transaction number", "R0/C0 suffix", "No R0/C0 pairs", false));
                continue;
            }
            for (Map.Entry<String, List<Map<String, String>>> pairEntry : pairs.entrySet()) {
                String transaction = pairEntry.getKey();
                Map<String, String> original = findSuffix(pairEntry.getValue(), "R0");
                Map<String, String> corrected = findSuffix(pairEntry.getValue(), "C0");
                if (original == null || corrected == null) {
                    results.add(new ExcelVerificationReportWriter.Verification(
                            file.getKey(), transaction, "transaction number", "R0 and C0",
                            original == null ? "Missing R0" : "Missing C0", false));
                    continue;
                }
                for (String field : original.keySet()) {
                    if (field.equals("transaction number")) {
                        continue;
                    }
                    results.add(compare(file.getKey(), transaction, field,
                            value(original, field), value(corrected, field)));
                }
            }
        }
        return results;
    }

    private Map<String, List<Map<String, String>>> pairRecords(List<Map<String, String>> records) {
        Map<String, List<Map<String, String>>> pairs = new LinkedHashMap<>();
        for (Map<String, String> record : records) {
            Matcher matcher = TRANSACTION_SUFFIX.matcher(value(record, "transaction number"));
            if (matcher.matches()) {
                pairs.computeIfAbsent(matcher.group(1), ignored -> new ArrayList<>()).add(record);
            }
        }
        return pairs;
    }

    private ExcelVerificationReportWriter.Verification compare(String fileName, String transaction,
            String field, String originalValue, String correctedValue) {
        String normalizedOriginal = originalValue;
        String normalizedCorrected = correctedValue;
        if (field.contains("date")) {
            normalizedOriginal = ValueNormalizer.normalizeDate(originalValue);
            normalizedCorrected = ValueNormalizer.normalizeDate(correctedValue);
        } else if (field.contains("amount")) {
            normalizedOriginal = ValueNormalizer.normalizeAmount(originalValue);
            normalizedCorrected = ValueNormalizer.normalizeAmount(correctedValue);
        }
        return new ExcelVerificationReportWriter.Verification(fileName, transaction, field,
                originalValue, correctedValue, ValueNormalizer.normalizeText(normalizedOriginal)
                        .equals(ValueNormalizer.normalizeText(normalizedCorrected)));
    }

    private Map<String, String> findSuffix(List<Map<String, String>> pair, String suffix) {
        for (Map<String, String> record : pair) {
            if (value(record, "transaction number").endsWith("-" + suffix)) {
                return record;
            }
        }
        return null;
    }

    private String value(Map<String, String> record, String column) {
        return record == null || record.get(column) == null ? "MISSING" : record.get(column).trim();
    }

}