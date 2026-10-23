package com.oracle.oic.monitor;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertFalse;
import static org.testng.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.testng.annotations.Test;

public class AlertStateStoreTest {

    @Test
    public void persistsDeliveredThresholdAcrossInstances() throws Exception {
        Path statePath = Files.createTempFile("oic-monitor-state", ".properties");
        Files.delete(statePath);
        try {
            AlertStateStore first = new AlertStateStore(statePath);
            assertFalse(first.hasDelivered("7779640", 60));
            first.markDelivered("7779640", 60);

            AlertStateStore restarted = new AlertStateStore(statePath);
            assertTrue(restarted.hasDelivered("7779640", 60));
            assertFalse(restarted.hasDelivered("7779640", 90));
            restarted.markDelivered("7779640", 90);
            assertEquals(new AlertStateStore(statePath).lastDeliveredThreshold("7779640"), 90);
        } finally {
            Files.deleteIfExists(statePath);
        }
    }

    @Test
    public void ignoresMalformedStateValues() throws Exception {
        Path statePath = Files.createTempFile("oic-monitor-state", ".properties");
        try {
            Files.writeString(statePath, "7779640=not-a-number\n");
            AlertStateStore store = new AlertStateStore(statePath);
            assertEquals(store.lastDeliveredThreshold("7779640"), 0);
        } finally {
            Files.deleteIfExists(statePath);
        }
    }
}
