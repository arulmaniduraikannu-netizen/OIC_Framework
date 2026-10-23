package com.oracle.oic.monitor;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

/** Restart-safe store of successfully delivered process thresholds. */
public final class AlertStateStore {

    private final Path statePath;
    private final Properties deliveredThresholds = new Properties();

    public AlertStateStore(Path statePath) {
        if (statePath == null) {
            throw new IllegalArgumentException("statePath cannot be null");
        }
        this.statePath = statePath;
        load();
    }

    public int lastDeliveredThreshold(String processId) {
        String value = deliveredThresholds.getProperty(processId);
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            deliveredThresholds.remove(processId);
            System.err.println("Ignoring malformed alert threshold for process " + processId + ".");
            return 0;
        }
    }

    public boolean hasDelivered(String processId, int thresholdMinutes) {
        return lastDeliveredThreshold(processId) >= thresholdMinutes;
    }

    public boolean hasDeliveredError(String processId) {
        return Boolean.parseBoolean(deliveredThresholds.getProperty("error." + processId));
    }

    public void markErrorDelivered(String processId) {
        if (processId == null || processId.isBlank()) {
            throw new IllegalArgumentException("processId cannot be blank");
        }
        deliveredThresholds.setProperty("error." + processId, "true");
        save();
    }

    public void markDelivered(String processId, int thresholdMinutes) {
        if (processId == null || processId.isBlank()) {
            throw new IllegalArgumentException("processId cannot be blank");
        }
        if (thresholdMinutes < AlertThresholdEvaluator.FIRST_THRESHOLD_MINUTES
                || thresholdMinutes % AlertThresholdEvaluator.THRESHOLD_STEP_MINUTES != 0) {
            throw new IllegalArgumentException("Invalid threshold: " + thresholdMinutes);
        }

        int current = lastDeliveredThreshold(processId);
        if (thresholdMinutes <= current) {
            return;
        }
        deliveredThresholds.setProperty(processId, Integer.toString(thresholdMinutes));
        save();
    }

    private void load() {
        if (!Files.isRegularFile(statePath)) {
            return;
        }
        try (InputStream input = Files.newInputStream(statePath)) {
            deliveredThresholds.load(input);
        } catch (IOException | IllegalArgumentException exception) {
            deliveredThresholds.clear();
            System.err.println("Unable to read monitor alert state; starting empty: "
                    + exception.getMessage());
        }
    }

    private void save() {
        try {
            Path parent = statePath.toAbsolutePath().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Path temporaryPath = statePath.resolveSibling(statePath.getFileName() + ".tmp");
            try (OutputStream output = Files.newOutputStream(temporaryPath)) {
                deliveredThresholds.store(output, "Oracle Fusion long-running process alerts");
            }
            try {
                Files.move(temporaryPath, statePath,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporaryPath, statePath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to persist monitor alert state: " + statePath, exception);
        }
    }
}
