package com.oracle.oic.monitor;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Calculates newly crossed half-hour thresholds for a process snapshot. */
public final class AlertThresholdEvaluator {

    public static final int FIRST_THRESHOLD_MINUTES = 60;
    public static final int THRESHOLD_STEP_MINUTES = 30;

    private AlertThresholdEvaluator() {
        throw new IllegalStateException("Utility class");
    }

    public static int highestNewThreshold(Duration elapsed, int lastDeliveredMinutes) {
        if (elapsed == null || elapsed.isNegative() || lastDeliveredMinutes < 0) {
            throw new IllegalArgumentException("Invalid elapsed duration or delivered threshold");
        }
        if (elapsed.compareTo(Duration.ofMinutes(FIRST_THRESHOLD_MINUTES)) < 0) {
            return 0;
        }
        long highest = FIRST_THRESHOLD_MINUTES
                + ((elapsed.toMinutes() - FIRST_THRESHOLD_MINUTES) / THRESHOLD_STEP_MINUTES)
                        * THRESHOLD_STEP_MINUTES;
        return highest > lastDeliveredMinutes ? Math.toIntExact(highest) : 0;
    }

    public static List<Integer> crossedThresholds(Duration elapsed, int lastDeliveredMinutes) {
        if (elapsed == null || elapsed.isNegative()) {
            throw new IllegalArgumentException("elapsed must be zero or positive");
        }
        if (lastDeliveredMinutes < 0) {
            throw new IllegalArgumentException("lastDeliveredMinutes cannot be negative");
        }

        long elapsedMinutes = elapsed.toMinutes();
        if (elapsedMinutes < FIRST_THRESHOLD_MINUTES) {
            return List.of();
        }

        long highestThreshold = FIRST_THRESHOLD_MINUTES
                + ((elapsedMinutes - FIRST_THRESHOLD_MINUTES) / THRESHOLD_STEP_MINUTES)
                        * THRESHOLD_STEP_MINUTES;
        List<Integer> thresholds = new ArrayList<>();
        for (long threshold = FIRST_THRESHOLD_MINUTES;
                threshold <= highestThreshold;
                threshold += THRESHOLD_STEP_MINUTES) {
            if (threshold > lastDeliveredMinutes) {
                thresholds.add(Math.toIntExact(threshold));
            }
        }
        return List.copyOf(thresholds);
    }
}
