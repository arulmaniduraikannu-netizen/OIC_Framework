package com.oracle.oic.utils;

import java.nio.file.Path;

import com.aventstack.extentreports.ExtentReports;
import com.aventstack.extentreports.ExtentTest;
import com.aventstack.extentreports.MediaEntityBuilder;
import com.aventstack.extentreports.reporter.ExtentSparkReporter;

/** Thread-safe Extent report lifecycle for TestNG automation. */
public final class ExtentReportManager {

    private static final ExtentReports REPORTS = createReports();
    private static final ThreadLocal<ExtentTest> CURRENT_TEST = new ThreadLocal<>();

    private ExtentReportManager() {
        throw new IllegalStateException("Utility class");
    }

    public static void startTest(String name) {
        CURRENT_TEST.set(REPORTS.createTest(name));
    }

    public static void pass(String message) {
        currentTest().pass(message);
    }

    public static void info(String message) {
        currentTest().info(message);
    }

    public static void fail(Throwable throwable) {
        currentTest().fail(throwable);
    }

    public static void attachScreenshot(Path screenshotPath) {
        currentTest().info("Screenshot: " + screenshotPath,
                MediaEntityBuilder.createScreenCaptureFromPath(screenshotPath.toString()).build());
    }

    public static void flush() {
        REPORTS.flush();
        CURRENT_TEST.remove();
    }

    private static ExtentTest currentTest() {
        ExtentTest test = CURRENT_TEST.get();
        if (test == null) {
            throw new IllegalStateException("No Extent test is active.");
        }
        return test;
    }

    private static ExtentReports createReports() {
        ExtentSparkReporter reporter = new ExtentSparkReporter(
                Path.of("test-results", "extent", "ExtentReport.html").toString());
        ExtentReports reports = new ExtentReports();
        reports.attachReporter(reporter);
        return reports;
    }
}
