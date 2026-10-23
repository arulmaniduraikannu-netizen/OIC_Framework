package com.oracle.oic.monitor;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Supplier;

import com.oracle.oic.utils.GoogleChatNotifier;

/** Executes one polling cycle and emits newly crossed long-running thresholds. */
public final class LongRunningProcessMonitor {

    private final Supplier<List<LongRunningProcess>> processSupplier;
    private final AlertStateStore stateStore;
    private final GoogleChatNotifier notifier;

    public LongRunningProcessMonitor(
            Supplier<List<LongRunningProcess>> processSupplier,
            AlertStateStore stateStore,
            GoogleChatNotifier notifier) {
        this.processSupplier = Objects.requireNonNull(processSupplier, "processSupplier cannot be null");
        this.stateStore = Objects.requireNonNull(stateStore, "stateStore cannot be null");
        this.notifier = Objects.requireNonNull(notifier, "notifier cannot be null");
    }

    public void runOnce() {
        List<LongRunningProcess> processes = processSupplier.get();
        List<ProcessAlert> alerts = new ArrayList<>();
        for (LongRunningProcess process : processes) {
            if ("Error".equalsIgnoreCase(process.status())) {
                if (!stateStore.hasDeliveredError(process.processId())) {
                    alerts.add(new ProcessAlert(process, 0));
                }
                continue;
            }
            if (process.elapsed() == null) {
                System.err.println("Duration unavailable for process " + process.processId()
                        + "; no duration alert evaluated.");
                continue;
            }
            int lastDelivered = stateStore.lastDeliveredThreshold(process.processId());
            int threshold = AlertThresholdEvaluator.highestNewThreshold(process.elapsed(), lastDelivered);
            if (threshold > 0) {
                alerts.add(new ProcessAlert(process, threshold));
            }
        }
        if (!notifier.notifyProcesses(alerts)) {
            return;
        }
        for (ProcessAlert alert : alerts) {
            if (alert.isError()) {
                stateStore.markErrorDelivered(alert.process().processId());
            } else {
                stateStore.markDelivered(alert.process().processId(), alert.thresholdMinutes());
            }
        }
    }
}
