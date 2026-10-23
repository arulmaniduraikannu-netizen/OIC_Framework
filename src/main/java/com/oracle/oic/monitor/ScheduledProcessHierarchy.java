package com.oracle.oic.monitor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Accumulates the runtime ADF row keys and loaded ranges verified on 22 October 2026. */
public final class ScheduledProcessHierarchy {
    public record Row(String key, String ancestorPath, LongRunningProcess process) { }

    private final Set<String> rootNames;
    private final Map<String, Row> rows = new LinkedHashMap<>();
    private final Map<Integer, String> loadedSlots = new HashMap<>();
    private int expectedRows;

    public ScheduledProcessHierarchy(List<String> rootNames) {
        this.rootNames = Set.copyOf(rootNames);
    }

    public void observe(List<Row> visibleRows, Map<Integer, String> slots, int totalRows) {
        expectedRows = Math.max(expectedRows, totalRows);
        for (Row row : visibleRows) {
            Row previous = rows.put(row.key(), row);
            if (previous != null && !previous.process().processId().equals(row.process().processId())) {
                throw new IllegalStateException("Hierarchy key changed identity: " + row.key());
            }
        }
        slots.forEach((slot, processId) -> {
            String previous = loadedSlots.put(slot, processId);
            if (previous != null && !previous.equals(processId)) {
                throw new IllegalStateException("Loaded range changed without expansion at row " + slot);
            }
        });
    }

    public void expanded() {
        loadedSlots.clear();
        expectedRows = 0;
    }

    public boolean includes(Row row) {
        String rootKey = row.ancestorPath().isBlank()
                ? row.key() : row.ancestorPath().split("_")[0];
        Row root = rows.get(rootKey);
        return root != null && root.ancestorPath().isBlank()
                && (rootNames.isEmpty() || rootNames.contains(root.process().processName()));
    }

    public boolean isComplete() {
        if (expectedRows == 0 || loadedSlots.size() != expectedRows
                || new HashSet<>(loadedSlots.values()).size() != expectedRows) {
            return false;
        }
        for (int slot = 0; slot < expectedRows; slot++) {
            if (!loadedSlots.containsKey(slot)) {
                return false;
            }
        }
        return true;
    }

    public List<LongRunningProcess> selectedProcesses() {
        if (!isComplete()) {
            throw new IllegalStateException("Incomplete hierarchy: loaded " + loadedSlots.size()
                    + " unique row positions of " + expectedRows);
        }
        Set<String> observedIds = new HashSet<>();
        for (Row row : rows.values()) {
            observedIds.add(row.process().processId());
            String prefix = "";
            if (!row.ancestorPath().isBlank()) {
                for (String key : row.ancestorPath().split("_")) {
                    Row ancestor = rows.get(key);
                    if (ancestor == null || !ancestor.ancestorPath().equals(prefix)) {
                        throw new IllegalStateException("Unresolved ancestry for " + row.process().processId());
                    }
                    prefix = prefix.isEmpty() ? key : prefix + "_" + key;
                }
            }
        }
        if (!observedIds.equals(new HashSet<>(loadedSlots.values()))) {
            throw new IllegalStateException("Loaded row ranges do not match the observed process IDs");
        }
        Map<String, LongRunningProcess> selected = new LinkedHashMap<>();
        for (Row row : rows.values()) {
            if (includes(row)) {
                selected.put(row.process().processId(), row.process());
            }
        }
        return new ArrayList<>(selected.values());
    }
}