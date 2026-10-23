package com.oracle.oic.utils;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Reads the first CSV payload from a ZIP archive. */
public final class CsvZipReader {

    private CsvZipReader() {
        throw new IllegalStateException("Utility class");
    }

    public static List<Map<String, String>> readCsv(Path archive) throws IOException {
        return readCsv(archive, record -> true);
    }

    public static List<Map<String, String>> readCsvFile(Path csvFile) throws IOException {
        return readCsvFile(csvFile, record -> true);
    }

    public static List<Map<String, String>> readCsvFile(
            Path csvFile, Predicate<Map<String, String>> recordFilter) throws IOException {
        try (Reader reader = Files.newBufferedReader(csvFile, StandardCharsets.UTF_8)) {
            return parseCsv(reader, recordFilter);
        }
    }

    public static List<Map<String, String>> readCsv(
            Path archive, Predicate<Map<String, String>> recordFilter) throws IOException {
        try (ZipInputStream zipInputStream = new ZipInputStream(Files.newInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zipInputStream.getNextEntry()) != null) {
                if (!entry.isDirectory() && entry.getName().toLowerCase().endsWith(".csv")) {
                    try (Reader reader = new InputStreamReader(zipInputStream, StandardCharsets.UTF_8)) {
                        return parseCsv(reader, recordFilter);
                    }
                }
            }
        }
        throw new IllegalArgumentException("No CSV payload found in " + archive);
    }

        private static List<Map<String, String>> parseCsv(
            Reader reader, Predicate<Map<String, String>> recordFilter) throws IOException {
        BufferedReader bufferedReader = new BufferedReader(reader);
        List<String> headers = parseCsvLine(bufferedReader.readLine());
        List<Map<String, String>> records = new ArrayList<>();
        String line;
        while ((line = bufferedReader.readLine()) != null) {
            List<String> values = parseCsvLine(line);
            Map<String, String> record = new LinkedHashMap<>();
            for (int index = 0; index < headers.size(); index++) {
                record.put(headers.get(index), index < values.size() ? values.get(index) : "");
            }
            if (recordFilter.test(record)) {
                records.add(record);
            }
        }
        return records;
    }

    private static List<String> parseCsvLine(String line) {
        if (line == null) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        StringBuilder value = new StringBuilder();
        boolean quoted = false;
        for (int index = 0; index < line.length(); index++) {
            char character = line.charAt(index);
            if (character == '"') {
                if (quoted && index + 1 < line.length() && line.charAt(index + 1) == '"') {
                    value.append('"');
                    index++;
                } else {
                    quoted = !quoted;
                }
            } else if (character == ',' && !quoted) {
                values.add(value.toString());
                value.setLength(0);
            } else {
                value.append(character);
            }
        }
        values.add(value.toString());
        return values;
    }
}