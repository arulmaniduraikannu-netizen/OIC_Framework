---

description: "Plan and execute a verified deterministic Excel analysis for supplied CSV, XLSX, or ZIP files."
argument-hint: Excel files and analysis request (e.g. "Compare these 3 workbooks and return only records where Event Date changed")
agent: excel-expert
-------------------

# Excel Expert: ${input:request}

This is a thin parameterized launcher. The actual Excel behavior and safety rules live in:

* **Workflow & rules** → [excel-expert.instructions.md](../instructions/excel-expert.instructions.md)
* **Agent persona & capabilities** → already active via `agent: excel-expert` above

## Required execution lifecycle

For every `/excel-expert` run, follow this lifecycle strictly:

1. **Inspect**

   * Discover workbook/file structure, sheets, tables, headers, row counts, and diagnostics.
   * Inspect the available local operation capabilities and MCP capabilities.

2. **Plan**

   * Convert the complete user request into a typed operation plan.
   * Identify:

     * input files
     * target sheets/tables
     * exact source columns
     * match keys
     * comparison fields
     * requested output fields
     * one-row vs all-row scope
     * expected output artifact

3. **Select capability**

   * Prefer the deterministic local Excel operation registry.
   * Use Excel MCP only when the request cannot be represented by the local registry.
   * Never use MCP while clarification is pending.

4. **Execute**

   * Execute only the operations defined by the validated plan.
   * Preserve operation facts, diagnostics, provenance, and intermediate results.
   * For MCP execution, use staged files and the configured MCP safety guard.

5. **Validate**

   * Validate the result against:

     * the typed plan
     * workbook schema
     * requested scope
     * operation diagnostics
     * output artifact requirements
   * Do not treat metadata as cell-value evidence.
   * Do not treat zero matches as a successful comparison.

6. **Repair**

   * If the issue is repairable, retry through an allowed deterministic operation or supported MCP recovery path.
   * For multi-file or cross-sheet analysis, use bounded recovery rather than repeatedly issuing uncontrolled tool calls.
   * Do not invent data when recovery fails.

7. **Return**

   * Return the requested result and output artifact when possible.
   * Clearly identify whether the result is:

     * deterministic local
     * MCP-derived and not locally verified
     * clarification-needed
     * unsupported/explained failure
   * Preserve source/provenance for reported values.

## Clarification gate

Before execution, ask a focused question when any required item is ambiguous:

* workbook/sheet/table
* column
* match key
* comparison field
* requested output fields
* one result vs all results
* expected output file/sheet

Do not guess.

For lookup operations:

* `ROW_NOT_FOUND` → request clarification.
* `MULTIPLE_ROWS_FOUND` when one row was expected → request clarification.
* Compare fields only after the target row is uniquely identified.
* Preserve identifiers exactly. Do not convert visually similar characters such as `O` and `0`.

## Changed-record output rule

When the user asks for **changed records**, return only records where the requested comparison field actually changed.

Do not return:

* unchanged records
* all source rows
* diagnostic rows
* workbook metadata
* helper/calculation columns unless explicitly requested

When an Excel output is requested, prefer a **single output workbook/sheet containing only the changed records**, unless the user explicitly requests multiple sheets or additional diagnostics.

Do not replace a requested changed-value output with Excel serial numbers such as `46192`. Preserve or convert dates into a human-readable date representation according to the workbook's actual date semantics.

## Generic Excel requirement

Do not assume the request is about transactions, Event Date, or any particular workbook layout.

The same workflow must support arbitrary:

* CSV
* XLSX
* ZIP containing workbooks
* sheets
* tables
* identifiers
* comparison columns
* aggregation requirements

Return a typed operation plan and any unresolved questions before execution when the command is being used for planning only.

For execution requests, continue through execution, validation, repair, and final artifact generation according to `excel-expert.instructions.md`.

## Run it

Analyze and execute the following Excel request:

**`${input:request}`**
