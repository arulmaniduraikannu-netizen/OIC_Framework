package com.oracle.oic.monitor;

import java.time.Clock;
import java.time.Duration;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
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
        try {
            return ZonedDateTime.parse(value.trim(),
                    DateTimeFormatter.ofPattern("M/d/yy h:mm a z", Locale.ENGLISH));
        } catch (DateTimeParseException exception) {
            return null;
        }
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
