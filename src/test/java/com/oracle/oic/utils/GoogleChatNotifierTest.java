package com.oracle.oic.utils;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.testng.annotations.Test;

import com.oracle.oic.pages.ScheduledProcessResult;
import com.oracle.oic.monitor.LongRunningProcess;
import com.oracle.oic.monitor.ProcessAlert;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

public class GoogleChatNotifierTest {

    @Test
    public void sendsRequiredProcessFieldsAsJson() throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> handle(exchange, requestBody));
        server.start();

        try {
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";
            ScheduledProcessResult result = new ScheduledProcessResult(
                    "7779419", "Purge Incentive Compensation Staging Table Data", "Succeeded",
                    "10/21/26 7:36 AM UTC", "10/21/26 7:38 AM UTC", "2 minutes");

            assertTrue(new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()).notifyProcess(result));
            String body = requestBody.get();
            assertTrue(body.contains("7779419"));
            assertTrue(body.contains("Purge Incentive Compensation Staging Table Data"));
            assertTrue(body.contains("Succeeded"));
            assertTrue(body.contains("10/21/26 7:36 AM UTC"));
            assertTrue(body.contains("10/21/26 7:38 AM UTC"));
            assertTrue(body.contains("2 minutes"));
        } finally {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange, AtomicReference<String> requestBody) throws IOException {
        requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        exchange.sendResponseHeaders(200, -1);
        exchange.close();
    }

    @Test
    public void skipsWhenWebhookIsNotConfigured() {
        ScheduledProcessResult result = new ScheduledProcessResult("7779419", "Process", "Succeeded", "submitted", "completed", "2 minutes");
        assertEquals(new GoogleChatNotifier("", HttpClient.newHttpClient()).notifyProcess(result), false);
    }

    @Test
    public void sendsThresholdAndAllLongRunningProcessFields() throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> handle(exchange, requestBody));
        server.start();

        try {
            LongRunningProcess process = new LongRunningProcess(
                    "7779908", "Scheduled Process", "Wait", "jane.doe",
                    "10/21/26 7:00 AM UTC", "10/21/26 7:01 AM UTC", "Unavailable",
                    Duration.ofMinutes(90));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";

            assertTrue(new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient())
                    .notifyProcess(process, 90));
            String body = requestBody.get();
            assertTrue(body.contains("7779908"));
            assertTrue(body.contains("jane.doe"));
            assertTrue(body.contains("10/21/26 7:01 AM UTC"));
            assertTrue(body.contains("1 hours 30 minutes"));
            assertTrue(body.contains("+"));
            assertTrue(body.contains("Process ID"));
            assertTrue(body.contains("Scheduled Process"));
            assertTrue(body.contains("Wait"));
            assertTrue(body.contains("|"));
            assertTrue(!body.contains("Reason"));
            assertTrue(!body.contains("Threshold"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    public void sendsMixedAlertsAsOneTableMessage() throws IOException {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/webhook", exchange -> handle(exchange, requestBody));
        server.start();

        try {
            LongRunningProcess error = new LongRunningProcess(
                    "error-1", "Process | With Detail", "Error", "jane.doe",
                    "submitted", "started", "Unavailable", null);
            LongRunningProcess longRunning = new LongRunningProcess(
                    "running-1", "Long Process", "Running", "john.doe",
                    "submitted", "started", "Unavailable", Duration.ofMinutes(60));
            String webhookUrl = "http://localhost:" + server.getAddress().getPort() + "/webhook";

            assertTrue(new GoogleChatNotifier(webhookUrl, HttpClient.newHttpClient()).notifyProcesses(List.of(
                    new ProcessAlert(error, 0), new ProcessAlert(longRunning, 60))));

            String body = requestBody.get();
            assertTrue(body.contains("+"));
            assertTrue(body.contains("error-1"));
            assertTrue(body.contains("Process / With Detail") || body.contains("Process"));
            assertTrue(body.contains("running-1"));
            assertTrue(body.contains("1 hours 0 minutes"));
        } finally {
            server.stop(0);
        }
    }
}