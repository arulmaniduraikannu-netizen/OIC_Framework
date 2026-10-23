package com.oracle.oic.monitor;

import static org.testng.Assert.assertEquals;

import java.time.Duration;
import java.util.List;

import org.testng.annotations.Test;

public class AlertThresholdEvaluatorTest {

    @Test
    public void highestThresholdIsStrictConsolidatedAndUncapped() {
        assertEquals(AlertThresholdEvaluator.highestNewThreshold(Duration.ofMinutes(60), 0), 60);
        assertEquals(AlertThresholdEvaluator.highestNewThreshold(Duration.ofMinutes(60).plusSeconds(1), 0), 60);
        assertEquals(AlertThresholdEvaluator.highestNewThreshold(Duration.ofMinutes(501), 0), 480);
        assertEquals(AlertThresholdEvaluator.highestNewThreshold(Duration.ofMinutes(540), 480), 540);
        assertEquals(AlertThresholdEvaluator.highestNewThreshold(Duration.ofMinutes(540), 540), 0);
    }

    @Test
    public void doesNotAlertBeforeFirstThreshold() {
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(59), 0), List.of());
    }

    @Test
    public void alertsAtSixtyMinutesAndEachNewHalfHour() {
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(60), 0), List.of(60));
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(90), 60), List.of(90));
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(180), 0),
                List.of(60, 90, 120, 150, 180));
    }

    @Test
    public void doesNotRepeatAlreadyDeliveredThresholds() {
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(120), 120), List.of());
        assertEquals(AlertThresholdEvaluator.crossedThresholds(Duration.ofMinutes(121), 90), List.of(120));
    }
}
