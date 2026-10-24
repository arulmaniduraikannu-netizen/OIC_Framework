package com.oracle.oic.monitor;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;

/** Snapshot of a scheduled process used by the recurring monitor. */
public record LongRunningProcess(
        String processId,
        String processName,
        String status,
        String submitter,
        String submissionTime,
        String startTime,
        String completionTime,
        Duration elapsed,
        String displayDuration) {

        private static final List<DateTimeFormatter> ZONED_TIME_FORMATTERS = List.of(
            DateTimeFormatter.ofPattern("M/d/yy h:mm a z", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yy h:mm:ss a z", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm a z", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm:ss a z", Locale.ENGLISH));
        private static final List<DateTimeFormatter> LOCAL_TIME_FORMATTERS = List.of(
            DateTimeFormatter.ofPattern("M/d/yy h:mm a", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yy h:mm:ss a", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm a", Locale.ENGLISH),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm:ss a", Locale.ENGLISH));

    public LongRunningProcess(String processId, String processName, String status, String submitter,
            String submissionTime, String startTime, String completionTime, Duration elapsed) {
        this(processId, processName, status, submitter, submissionTime, startTime, completionTime, elapsed, null);
    }

    public LongRunningProcess {
        processId = requireValue(processId, "processId");
        processName = valueOrUnavailable(processName);
        status = valueOrUnavailable(status);
        submitter = valueOrUnavailable(submitter);
        submissionTime = valueOrUnavailable(submissionTime);
        startTime = valueOrUnavailable(startTime);
        completionTime = valueOrUnavailable(completionTime);
        displayDuration = valueOrUnavailable(displayDuration);
        if (elapsed != null && elapsed.isNegative()) {
            throw new IllegalArgumentException("elapsed cannot be negative");
        }
    }

    public static Duration elapsedDuration(String status, String submissionTime,
            String startTime, String completionTime, Clock clock) {
        boolean active = "Running".equalsIgnoreCase(status) || "Wait".equalsIgnoreCase(status);
        ZonedDateTime start = parseTime(startTime);
        if (start == null && active) {
            start = parseTime(submissionTime);
        }
        ZonedDateTime end = active ? ZonedDateTime.now(clock) : parseTime(completionTime);
        if (start == null || end == null) {
            return null;
        }
        Duration duration = Duration.between(start, end);
        return duration.isNegative() ? null : duration;
    }

    private static ZonedDateTime parseTime(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String text = value.trim();
        for (DateTimeFormatter formatter : ZONED_TIME_FORMATTERS) {
            try {
                return ZonedDateTime.parse(text, formatter);
            } catch (DateTimeParseException ignored) {
            }
        }
        ZoneId fallbackZone = ZoneId.of(System.getProperty("oic.monitor.uiTimeZone", "UTC"));
        for (DateTimeFormatter formatter : LOCAL_TIME_FORMATTERS) {
            try {
                return LocalDateTime.parse(text, formatter).atZone(fallbackZone);
            } catch (DateTimeParseException ignored) {
            }
        }
        return null;
    }

    private static String requireValue(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " cannot be blank");
        }
        return value.trim();
    }

    private static String valueOrUnavailable(String value) {
        return value == null || value.isBlank() ? "Unavailable" : value.trim();
    }
}
