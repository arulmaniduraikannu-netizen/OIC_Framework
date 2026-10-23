package com.oracle.oic.utils;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Normalizes common Excel and CSV display differences for comparisons. */
public final class ValueNormalizer {

    private static final Pattern NUMBER = Pattern.compile("[-+]?\\d[\\d,]*(?:\\.\\d+)?");

    private ValueNormalizer() {
        throw new IllegalStateException("Utility class");
    }

    public static String normalizeAmount(String value) {
        String text = normalizeText(value);
        Matcher matcher = NUMBER.matcher(text);
        try {
            if (!matcher.find()) {
                return text;
            }
            return String.format("%.2f", Double.parseDouble(matcher.group().replace(",", "")));
        } catch (NumberFormatException exception) {
            return text;
        }
    }

    public static String normalizeDate(String value) {
        String trimmed = value == null ? "" : value.trim();
        for (DateTimeFormatter formatter : List.of(
                DateTimeFormatter.ISO_LOCAL_DATE,
                DateTimeFormatter.ofPattern("MM/dd/yy"),
                DateTimeFormatter.ofPattern("M/d/yy"))) {
            try {
                return LocalDate.parse(trimmed, formatter).toString();
            } catch (DateTimeParseException ignored) {
                // Try the next supported display format.
            }
        }
        return normalizeText(trimmed);
    }

    public static String normalizeText(String value) {
        return value == null ? "" : value.trim();
    }
}