package com.oracle.oic.utils;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
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

        List<String[]> rows = new ArrayList<>();
        rows.add(new String[] {"Process ID", "Process", "Status", "Submitter", "Submitted",
            "Started", "Completed", "Duration"});
        for (ProcessAlert alert : alerts) {
            LongRunningProcess process = alert.process();
            rows.add(new String[] {
                process.processId(), process.processName(), process.status(), process.submitter(),
                process.submissionTime(), process.startTime(), process.completionTime(),
                formatDuration(process)
            });
        }
        String message = "Scheduled process alerts\n\n```\n" + formatTable(rows) + "```";
        return sendMessage(message, alerts.size() + " scheduled process alerts");
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

    private String formatTable(List<String[]> rows) {
        int[] widths = {10, 48, 10, 10, 22, 22, 22, 20};
        StringBuilder table = new StringBuilder();
        String border = buildBorder(widths);
        table.append(border).append('\n');
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            List<String[]> wrappedCells = new ArrayList<>();
            int rowHeight = 1;
            for (int column = 0; column < widths.length; column++) {
                String[] lines = wrapCell(rows.get(rowIndex)[column], widths[column]);
                wrappedCells.add(lines);
                rowHeight = Math.max(rowHeight, lines.length);
            }
            for (int lineIndex = 0; lineIndex < rowHeight; lineIndex++) {
                table.append('|');
                for (int column = 0; column < widths.length; column++) {
                    String line = lineIndex < wrappedCells.get(column).length
                            ? wrappedCells.get(column)[lineIndex] : "";
                    table.append(' ').append(padRight(line, widths[column])).append(" |");
                }
                table.append('\n');
            }
            table.append(border).append('\n');
        }
        return table.toString();
    }

    private String buildBorder(int[] widths) {
        StringBuilder border = new StringBuilder("+");
        for (int width : widths) {
            border.append("-".repeat(width + 2)).append('+');
        }
        return border.toString();
    }

    private String[] wrapCell(String value, int width) {
        String normalized = value == null ? "" : value.replace('|', '/').replace('\r', ' ').replace('\n', ' ');
        List<String> lines = new ArrayList<>();
        for (int start = 0; start < normalized.length(); start += width) {
            lines.add(normalized.substring(start, Math.min(start + width, normalized.length())));
        }
        return lines.isEmpty() ? new String[] {""} : lines.toArray(String[]::new);
    }

    private String padRight(String value, int width) {
        return value + " ".repeat(Math.max(0, width - value.length()));
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }
}