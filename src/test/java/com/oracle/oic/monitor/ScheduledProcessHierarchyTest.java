package com.oracle.oic.monitor;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertFalse;
import static org.testng.Assert.assertTrue;
import static org.testng.Assert.expectThrows;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.testng.annotations.Test;

import com.oracle.oic.monitor.ScheduledProcessHierarchy.Row;

/** Exercises the observed 1-root, 5-child, 60-grandchild structure with synthetic runtime keys. */
public class ScheduledProcessHierarchyTest {
    @Test
    public void accumulatesAllSixtySixRowsAcrossLoadedRanges() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Workbook Root"));
        List<Row> rows = new ArrayList<>();
        rows.add(row("k0", "", "1000000", "Workbook Root"));
        for (int index = 1; index < 5; index++) {
            rows.add(row("k" + index, "k0", "100000" + index, "Child " + index));
        }
        for (int index = 5; index < 65; index++) {
            rows.add(row("k" + index, "k0_k4", "20000" + index, "Grandchild " + index));
        }
        rows.add(row("k65", "k0", "1000065", "Last child"));
        observe(hierarchy, rows, 0, 1, 66);
        observe(hierarchy, rows, 1, 5, 66);
        observe(hierarchy, rows, 5, 55, 66);
        assertFalse(hierarchy.isComplete());
        observe(hierarchy, rows, 55, 66, 66);
        assertTrue(hierarchy.isComplete());
        assertEquals(hierarchy.selectedProcesses().size(), 66);
        observe(hierarchy, rows, 55, 66, 66);
        assertEquals(hierarchy.selectedProcesses().size(), 66);
    }

    @Test
    public void exactRootNamesExcludeSubstringMatchesButKeepDifferentlyNamedDescendants() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Root"));
        List<Row> rows = List.of(row("91", "", "1", "Root"),
                row("96", "91", "2", "Different child name"),
                row("99", "91_96", "3", "Grandchild"),
                row("101", "", "4", "Root suffix"),
                row("106", "101", "5", "Root"));
        observe(hierarchy, rows, 0, 5, 5);
        assertEquals(hierarchy.selectedProcesses().stream().map(LongRunningProcess::processId).toList(),
                List.of("1", "2", "3"));
    }

    @Test
    public void metadataRowCountAloneDoesNotProveCompletion() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Root"));
        List<Row> rows = List.of(row("0", "", "1", "Root"));
        observe(hierarchy, rows, 0, 1, 66);
        assertFalse(hierarchy.isComplete());
        expectThrows(IllegalStateException.class, hierarchy::selectedProcesses);
    }

    @Test
    public void expansionInvalidatesEarlierPositionCoverage() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Root"));
        List<Row> rows = List.of(row("0", "", "1", "Root"), row("8", "0", "2", "Child"));
        observe(hierarchy, rows, 0, 1, 1);
        assertTrue(hierarchy.isComplete());
        hierarchy.expanded();
        observe(hierarchy, rows, 1, 2, 2);
        assertFalse(hierarchy.isComplete());
        observe(hierarchy, rows, 0, 1, 2);
        assertTrue(hierarchy.isComplete());
    }

    @Test
    public void rejectsUnresolvedAncestryEvenWhenAllPositionsAreLoaded() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Root"));
        List<Row> rows = List.of(row("0", "", "1", "Root"), row("8", "0_77", "2", "Orphan"));
        observe(hierarchy, rows, 0, 2, 2);
        expectThrows(IllegalStateException.class, hierarchy::selectedProcesses);
    }

    @Test
    public void rejectsDuplicateIdsMasqueradingAsCompleteRows() {
        ScheduledProcessHierarchy hierarchy = new ScheduledProcessHierarchy(List.of("Root"));
        List<Row> rows = List.of(row("0", "", "1", "Root"), row("8", "0", "1", "Duplicate"));
        observe(hierarchy, rows, 0, 2, 2);
        assertFalse(hierarchy.isComplete());
    }

    private void observe(ScheduledProcessHierarchy hierarchy, List<Row> rows, int start, int end, int total) {
        Map<Integer, String> slots = new LinkedHashMap<>();
        for (int index = start; index < end; index++) {
            slots.put(index, rows.get(index).process().processId());
        }
        hierarchy.observe(rows.subList(start, end), slots, total);
    }

    private Row row(String key, String path, String id, String name) {
        return new Row(key, path, new LongRunningProcess(id, name, "Succeeded", "tester",
                "", "", "", Duration.ofMinutes(65)));
    }
}