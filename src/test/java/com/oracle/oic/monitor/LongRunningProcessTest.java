package com.oracle.oic.monitor;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNull;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import org.testng.annotations.Test;

public class LongRunningProcessTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-10-22T12:00:00Z"), ZoneOffset.UTC);

    @Test
    public void activeDurationUsesStartThenSubmission() {
        assertEquals(LongRunningProcess.elapsedDuration("Running", "10/22/26 9:00 AM UTC",
                "10/22/26 10:00 AM UTC", "", clock), Duration.ofHours(2));
        assertEquals(LongRunningProcess.elapsedDuration("Running", "10/22/26 9:00 AM UTC",
                "", "", clock), Duration.ofHours(3));
        assertEquals(LongRunningProcess.elapsedDuration("Wait", "10/22/26 9:00 AM UTC",
                "", "", clock), Duration.ofHours(3));
    }

    @Test
    public void completedDurationDoesNotGrowWithClock() {
        Duration duration = LongRunningProcess.elapsedDuration("Succeeded", "10/21/26 9:00 AM UTC",
                "10/21/26 10:00 AM UTC", "10/21/26 6:21 PM UTC", clock);
        assertEquals(duration, Duration.ofMinutes(501));
        assertEquals(duration, LongRunningProcess.elapsedDuration("Succeeded", "10/21/26 9:00 AM UTC",
                "10/21/26 10:00 AM UTC", "10/21/26 6:21 PM UTC",
                Clock.offset(clock, Duration.ofDays(10))));
    }

    @Test
    public void unknownAndContradictoryTimestampsAreNotZeroDuration() {
        assertNull(LongRunningProcess.elapsedDuration("Running", "", "", "", clock));
        assertNull(LongRunningProcess.elapsedDuration("Succeeded", "10/22/26 9:00 AM UTC",
                "", "", clock));
        assertNull(LongRunningProcess.elapsedDuration("Succeeded", "10/22/26 9:00 AM UTC",
                "", "10/22/26 11:00 AM UTC", clock));
        assertNull(LongRunningProcess.elapsedDuration("Running", "10/23/26 9:00 AM UTC",
                "", "", clock));
    }
}