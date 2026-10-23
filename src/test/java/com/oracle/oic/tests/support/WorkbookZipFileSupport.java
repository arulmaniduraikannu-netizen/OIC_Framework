package com.oracle.oic.tests.support;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.oracle.oic.base.BaseTest;
import com.oracle.oic.utils.ExcelReader;

public abstract class WorkbookZipFileSupport extends BaseTest {

    private static final Pattern ZIP_FILE_PATTERN = Pattern.compile("\\b\\S+\\.zip\\b");

    protected List<String> readWorkbookZipFileNames(String workbook, String sheet, String emptyMessage) {
        return readWorkbookZipFileNames(workbook, sheet, null, emptyMessage);
    }

    protected List<String> readWorkbookZipFileNames(String workbook, String sheet,
            String scenario, String emptyMessage) {
        List<String> fileNames = new ArrayList<>();
        List<Object[]> rows = scenario == null
                ? List.of(ExcelReader.readRows(workbook, sheet))
                : WorkbookScenarioReader.scenarioRows(workbook, sheet, scenario);
        for (Object[] row : rows) {
            for (Object value : row) {
                if (value == null) {
                    continue;
                }
                Matcher matcher = ZIP_FILE_PATTERN.matcher(value.toString());
                while (matcher.find() && !fileNames.contains(matcher.group())) {
                    fileNames.add(matcher.group());
                }
            }
        }
        if (fileNames.isEmpty()) {
            throw new IllegalArgumentException(emptyMessage + workbook);
        }
        return fileNames;
    }
}