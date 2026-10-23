package com.oracle.oic.utils;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.monitor.ProcessAlert;
import com.oracle.oic.pages.ScheduledProcessResult;

public final class GoogleChatNotifier {

    private static final String WEBHOOK_ENVIRONMENT_VARIABLE = "OIC_GOOGLE_CHAT_WEBHOOK_URL";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final String webhookUrl;
    private final HttpClient httpClient;

    public GoogleChatNotifier() {
        this(resolveWebhookUrl(), HttpClient.newHttpClient());
    }

    GoogleChatNotifier(String webhookUrl, HttpClient httpClient) {
        this.webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
        this.httpClient = httpClient;
    }

    private static String resolveWebhookUrl() {
        String environmentValue = System.getenv(WEBHOOK_ENVIRONMENT_VARIABLE);
        if (environmentValue != null && !environmentValue.isBlank()) {
            return environmentValue;
        }
        Path dotenvFile = Path.of(".env");
        if (!Files.isRegularFile(dotenvFile)) {
            return "";
        }
        try {
            for (String line : Files.readAllLines(dotenvFile)) {
                String trimmedLine = line.trim();
                if (trimmedLine.startsWith(WEBHOOK_ENVIRONMENT_VARIABLE + "=")) {
                    return trimmedLine.substring(trimmedLine.indexOf('=') + 1)
                            .trim().replaceAll("^\"|\"$", "");
                }
            }
        } catch (IOException exception) {
            System.err.println("Unable to read .env for Google Chat notification: "
                    + exception.getMessage());
        }
        return "";
    }

    public boolean notifyProcess(ScheduledProcessResult result) {
        if (webhookUrl.isBlank()) {
            System.out.println("Google Chat notification skipped: "
                    + WEBHOOK_ENVIRONMENT_VARIABLE + " is not configured.");
            return false;
        }

        String message = String.format(
                "Scheduled process result%nProcess ID: %s%nProcess: %s%nStatus: %s%n"
                        + "Submitted: %s%nCompleted: %s%nDuration: %s",
                result.processId(), result.processName(), result.status(),
                result.submissionTime(), result.completionTime(), result.duration());
        HttpRequest request = HttpRequest.newBuilder(URI.create(webhookUrl))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\""
                        + escapeJson(message) + "\"}"))
                .build();

        try {
            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                System.out.println("Google Chat notification sent for process " + result.processId() + ".");
                return true;
            }
            System.err.println("Google Chat notification failed with HTTP status " + response.statusCode() + ".");
        } catch (IOException | InterruptedException | IllegalArgumentException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            System.err.println("Google Chat notification failed: " + exception.getMessage());
        }
        return false;
    }

    public boolean notifyProcess(LongRunningProcess process, int thresholdMinutes) {
        return notifyProcesses(List.of(new ProcessAlert(process, thresholdMinutes)));
    }

    public boolean notifyProcesses(List<ProcessAlert> alerts) {
        if (alerts == null || alerts.isEmpty()) {
            return true;
        }
        if (webhookUrl.isBlank()) {
            System.out.println("Google Chat notification skipped: "
                    + WEBHOOK_ENVIRONMENT_VARIABLE + " is not configured.");
            return false;
        }

        StringBuilder message = new StringBuilder("Scheduled process alerts\n\n")
                .append("| Process ID | Process | Status | Submitter | Submitted | Started | Completed | Duration | Reason | Threshold |\n")
                .append("|---|---|---|---|---|---|---|---|---|---|\n");
        for (ProcessAlert alert : alerts) {
            LongRunningProcess process = alert.process();
            String reason = alert.isError() ? "Error status" : "Duration threshold crossed";
            String threshold = alert.isError() ? "Error" : alert.thresholdMinutes() + " minutes";
            message.append('|').append(tableCell(process.processId()))
                    .append('|').append(tableCell(process.processName()))
                    .append('|').append(tableCell(process.status()))
                    .append('|').append(tableCell(process.submitter()))
                    .append('|').append(tableCell(process.submissionTime()))
                    .append('|').append(tableCell(process.startTime()))
                    .append('|').append(tableCell(process.completionTime()))
                    .append('|').append(tableCell(formatDuration(process)))
                    .append('|').append(tableCell(reason))
                    .append('|').append(tableCell(threshold)).append("|\n");
        }
        return sendMessage(message.toString(), alerts.size() + " scheduled process alerts");
    }

    public boolean notifyMonitorStatus(int processCount) {
        if (webhookUrl.isBlank()) {
            System.out.println("Google Chat notification skipped: "
                    + WEBHOOK_ENVIRONMENT_VARIABLE + " is not configured.");
            return false;
        }

        String message = String.format(
                "Scheduled process monitor completed%nProcesses inspected: %d%n"
                        + "No process crossed a new 60-minute alert threshold.",
                processCount);
        return sendMessage(message, "monitor-status");
    }

    private boolean sendMessage(String message, String processId) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(webhookUrl))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json; charset=UTF-8")
                .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\""
                        + escapeJson(message) + "\"}"))
                .build();
        try {
            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                System.out.println("Google Chat notification sent for process " + processId + ".");
                return true;
            }
            System.err.println("Google Chat notification failed with HTTP status "
                    + response.statusCode() + ".");
        } catch (IOException | InterruptedException | IllegalArgumentException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            System.err.println("Google Chat notification failed: " + exception.getMessage());
        }
        return false;
    }

    private String formatDuration(LongRunningProcess process) {
        if (!"Unavailable".equals(process.displayDuration())) {
            return process.displayDuration();
        }
        return formatDuration(process.elapsed());
    }

    private String formatDuration(Duration duration) {
        if (duration == null) {
            return "Unavailable";
        }
        long minutes = duration.toMinutes();
        long hours = minutes / 60;
        long remainingMinutes = minutes % 60;
        return hours == 0 ? remainingMinutes + " minutes"
                : hours + " hours " + remainingMinutes + " minutes";
    }

    private String tableCell(String value) {
        return value.replace("|", "\\|").replace("\r", "<br>").replace("\n", "<br>");
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }
}