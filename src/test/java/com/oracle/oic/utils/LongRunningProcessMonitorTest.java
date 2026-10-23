package com.oracle.oic.utils;

import static org.testng.Assert.assertEquals;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.testng.annotations.Test;

import com.oracle.oic.monitor.AlertStateStore;
import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.monitor.LongRunningProcessMonitor;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

public class LongRunningProcessMonitorTest {

    @Test
    public void persistsThresholdOnlyAfterSuccessfulDelivery() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor", ".properties");
        Files.deleteIfExists(statePath);
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> respond(exchange, requestCount));
        server.start();

        try {
            LongRunningProcess process = new LongRunningProcess(
                    "7779908", "Scheduled Process", "Wait", "jane.doe",
                    "10/21/26 7:00 AM UTC", "10/21/26 7:01 AM UTC", "Unavailable",
                    Duration.ofMinutes(90));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            AlertStateStore stateStore = new AlertStateStore(statePath);
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                    () -> List.of(process), stateStore,
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()));

            monitor.runOnce();

                assertEquals(requestCount.get(), 1);
            assertEquals(stateStore.lastDeliveredThreshold("7779908"), 90);
                new LongRunningProcessMonitor(() -> List.of(process), new AlertStateStore(statePath),
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient())).runOnce();
                assertEquals(requestCount.get(), 1);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void staysSilentWhenNoThresholdIsCrossed() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-status", ".properties");
        Files.deleteIfExists(statePath);
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> respond(exchange, requestCount));
        server.start();

        try {
            LongRunningProcess process = new LongRunningProcess(
                    "7780002", "Scheduled Process", "Running", "jane.doe",
                    "10/21/26 7:00 AM UTC", "10/21/26 7:01 AM UTC", "Unavailable",
                    Duration.ofMinutes(30));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                    () -> List.of(process), new AlertStateStore(statePath),
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()));

            monitor.runOnce();

            assertEquals(requestCount.get(), 0);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void doesNotAdvanceStateWhenNotificationFails() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-failure", ".properties");
        Files.deleteIfExists(statePath);
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> {
            requestCount.incrementAndGet();
            int status = requestCount.get() == 1 ? 500 : 200;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();

        try {
            LongRunningProcess process = new LongRunningProcess(
                    "7780001", "Scheduled Process", "Wait", "jane.doe",
                    "10/21/26 7:00 AM UTC", "10/21/26 7:01 AM UTC", "Unavailable",
                    Duration.ofMinutes(60).plusSeconds(1));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            AlertStateStore stateStore = new AlertStateStore(statePath);
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                    () -> List.of(process), stateStore,
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()));

            monitor.runOnce();
            assertEquals(stateStore.lastDeliveredThreshold("7780001"), 0);
            assertEquals(requestCount.get(), 1);

            monitor.runOnce();
            assertEquals(stateStore.lastDeliveredThreshold("7780001"), 60);
            assertEquals(requestCount.get(), 2);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void deliversMixedErrorAndDurationAlertsInOneRequest() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-batch", ".properties");
        Files.deleteIfExists(statePath);
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> respond(exchange, requestCount));
        server.start();

        try {
            LongRunningProcess error = new LongRunningProcess("batch-error", "Error process", "Error",
                    "tester", "submitted", "", "", null);
            LongRunningProcess duration = new LongRunningProcess("batch-duration", "Long process", "Running",
                    "tester", "submitted", "started", "", Duration.ofMinutes(60));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            AlertStateStore state = new AlertStateStore(statePath);
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                    () -> List.of(error, duration), state,
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()));

            monitor.runOnce();

            assertEquals(requestCount.get(), 1);
            assertEquals(state.hasDeliveredError("batch-error"), true);
            assertEquals(state.lastDeliveredThreshold("batch-duration"), 60);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void failedBatchLeavesEveryAlertRetryable() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-batch-failure", ".properties");
        Files.deleteIfExists(statePath);
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> {
            int status = requestCount.incrementAndGet() == 1 ? 500 : 200;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();

        try {
            LongRunningProcess error = new LongRunningProcess("retry-error", "Error process", "Error",
                    "tester", "submitted", "", "", null);
            LongRunningProcess duration = new LongRunningProcess("retry-duration", "Long process", "Running",
                    "tester", "submitted", "started", "", Duration.ofMinutes(90));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            AlertStateStore state = new AlertStateStore(statePath);
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(
                    () -> List.of(error, duration), state,
                    new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()));

            monitor.runOnce();
            assertEquals(state.hasDeliveredError("retry-error"), false);
            assertEquals(state.lastDeliveredThreshold("retry-duration"), 0);

            monitor.runOnce();
            assertEquals(requestCount.get(), 2);
            assertEquals(state.hasDeliveredError("retry-error"), true);
            assertEquals(state.lastDeliveredThreshold("retry-duration"), 90);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void completedProcessDeliversOnlyHighestThresholdAcrossRestart() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-completed", ".properties");
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> respond(exchange, requestCount));
        server.start();
        try {
            LongRunningProcess process = new LongRunningProcess("completed-1", "Process", "Succeeded",
                    "tester", "submitted", "started", "completed", Duration.ofMinutes(501));
            GoogleChatNotifier notifier = new GoogleChatNotifier(
                    "http://localhost:" + server.getAddress().getPort() + "/webhook", HttpClient.newHttpClient());
            new LongRunningProcessMonitor(() -> List.of(process), new AlertStateStore(statePath), notifier).runOnce();
            new LongRunningProcessMonitor(() -> List.of(process), new AlertStateStore(statePath), notifier).runOnce();
            assertEquals(requestCount.get(), 1);
            assertEquals(new AlertStateStore(statePath).lastDeliveredThreshold("completed-1"), 480);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void errorRetriesAndDeduplicatesSeparatelyFromDurationAcrossRestart() throws IOException {
        Path statePath = Files.createTempFile("oic-monitor-error", ".properties");
        AtomicInteger requestCount = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> {
            int status = requestCount.incrementAndGet() == 1 ? 500 : 200;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
        try {
            LongRunningProcess process = new LongRunningProcess("error-1", "Process", "Error",
                    "tester", "submitted", "", "", null);
            GoogleChatNotifier notifier = new GoogleChatNotifier(
                    "http://localhost:" + server.getAddress().getPort() + "/webhook", HttpClient.newHttpClient());
            AlertStateStore state = new AlertStateStore(statePath);
            state.markDelivered("error-1", 90);
            LongRunningProcessMonitor monitor = new LongRunningProcessMonitor(() -> List.of(process), state, notifier);
            monitor.runOnce();
            assertEquals(state.hasDeliveredError("error-1"), false);
            monitor.runOnce();
            assertEquals(state.hasDeliveredError("error-1"), true);
            new LongRunningProcessMonitor(() -> List.of(process), new AlertStateStore(statePath), notifier).runOnce();
            assertEquals(requestCount.get(), 2);
            assertEquals(new AlertStateStore(statePath).lastDeliveredThreshold("error-1"), 90);
        } finally {
            server.stop(0);
            Files.deleteIfExists(statePath);
        }
    }

    private void respond(HttpExchange exchange, AtomicInteger requestCount) throws IOException {
        requestCount.incrementAndGet();
        exchange.sendResponseHeaders(200, -1);
        exchange.close();
    }
}