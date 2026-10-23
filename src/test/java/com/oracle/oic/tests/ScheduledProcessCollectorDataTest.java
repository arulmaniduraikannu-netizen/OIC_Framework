package com.oracle.oic.tests;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNull;
import static org.testng.Assert.assertTrue;
import static org.testng.Assert.expectThrows;

import java.time.Duration;
import java.util.List;

import org.testng.annotations.Test;

import com.oracle.oic.pages.ScheduledProcessesPage;
import com.oracle.oic.tests.support.ScheduledProcessWorkbookSupport;

/** Validates scenario 14 through the existing reader without modifying either workbook. */
public class ScheduledProcessCollectorDataTest {
    @Test
    public void readsScenarioFourteenIncludingTheAddedJobset() {
        List<String> names = ScheduledProcessWorkbookSupport.rootNames();
        assertEquals(names.size(), 7);
        assertTrue(names.contains("Calculation Jobset VSA BU"));
        assertTrue(names.contains("Calculate Incentive Earnings for All Participants Within Business Unit"));
        assertEquals(names.stream().distinct().count(), (long) names.size());
    }

    @Test
    public void trimsAndDeduplicatesWorkbookNames() {
        assertEquals(ScheduledProcessWorkbookSupport.namesFromStep("type the names like Root, Child,Root\n"),
                List.of("Root", "Child"));
        expectThrows(IllegalArgumentException.class,
                () -> ScheduledProcessWorkbookSupport.namesFromStep("type the names like Root,"));
    }

    @Test
    public void parsesOracleDurationAndPreservesMissingValues() {
        assertEquals(ScheduledProcessesPage.parseOracleDuration("8 hours 21 minutes"), Duration.ofMinutes(501));
        assertEquals(ScheduledProcessesPage.parseOracleDuration("8 hours and 21 minutes"), Duration.ofMinutes(501));
        assertEquals(ScheduledProcessesPage.parseOracleDuration(" 7 hours 29 minutes "), Duration.ofMinutes(449));
        assertEquals(ScheduledProcessesPage.parseOracleDuration("0 seconds"), Duration.ZERO);
        assertEquals(ScheduledProcessesPage.parseOracleDuration("1 day 2 hours 3 minutes 4 seconds"),
                Duration.ofDays(1).plusHours(2).plusMinutes(3).plusSeconds(4));
        assertNull(ScheduledProcessesPage.parseOracleDuration(null));
        assertNull(ScheduledProcessesPage.parseOracleDuration(""));
        assertNull(ScheduledProcessesPage.parseOracleDuration("Unavailable"));
        assertNull(ScheduledProcessesPage.parseOracleDuration("-5 minutes"));
    }
}