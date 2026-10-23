package com.oracle.oic.monitor;

/** A scheduled-process alert selected for delivery in the current monitor cycle. */
public record ProcessAlert(LongRunningProcess process, int thresholdMinutes) {

    public ProcessAlert {
        if (process == null) {
            throw new IllegalArgumentException("process cannot be null");
        }
        if (thresholdMinutes < 0) {
            throw new IllegalArgumentException("thresholdMinutes cannot be negative");
        }
    }

    public boolean isError() {
        return thresholdMinutes == 0;
    }
}