package com.oracle.oic.pages;

public record ScheduledProcessResult(
        String processId,
        String processName,
        String status,
        String submissionTime,
        String completionTime,
        String duration) {
}