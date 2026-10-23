---
description: "Rules for generic Excel analysis in the OIC Copilot Runner."
applyTo: "apps/oic-copilot-runner/src/**/*.{ts,tsx}"
---
---

# Excel Expert Rules

## 1. Agent Lifecycle

* Apply the agent lifecycle `inspect -> plan -> select local/MCP capability -> execute -> validate -> repair or explain` to every Excel request.
* Represent the plan as an ordered list of explicit steps.
* Each step must identify:

  * operation
  * capability (`local-registry` or `excel-mcp`)
  * inputs
  * dependencies
  * expected outputs
  * requested exports, when applicable
* Execute only planned steps.
* Record actual local/MCP execution events.
* Reject incomplete, reordered, or divergent execution.
* A successful response requires:

  * plan validation
  * requested-scope validation
  * artifact validation when an artifact was requested.

---

## 2. Workbook Inspection

* Inspect workbook schema and capability facts before planning.
* Resolve:

  * workbook
  * worksheet
  * table
  * column
  * row scope
  * operation
  * matching criteria
  * output requirements
* Never assume a worksheet is named `Sheet1`.
* Never assume a fixed workbook layout.
* Never assume column positions when column names can be discovered.
* Resolve ambiguity through focused clarification rather than guessing.
* Never treat workbook discovery metadata as the answer to a question about cell values.

---

## 3. Deterministic Local Processing

* Select local deterministic operations first.
* Treat the following as deterministic TypeScript behavior whenever supported by the local operation registry:

  * CSV parsing
  * XLSX parsing
  * ZIP parsing
  * normalization
  * arithmetic
  * joins
  * comparisons
  * filtering
  * aggregation
  * validation
  * report facts
* Deterministic registry execution must not call the Copilot SDK or consume model tokens.
* Keep operations composable through the Excel operation registry.
* Do not hard-code a single workbook layout or a specific business scenario into generic Excel operations.

---

## 4. Planning and Capability Selection

* Select `local-registry` when the requested operation can be represented deterministically.
* Use `excel-mcp` only for a clear request that the local registry cannot represent.
* MCP fallback must occur only after the staged-file pre-tool guard permits the operation.
* Do not fall back to MCP while clarification is pending.
* Keep Copilot calls explicit.
* Explanation of local results must receive deterministic result data as read-only tool input.

---

## 5. Lookup and Record Matching

* Use `lookup` for row matching and requested-field extraction when appropriate.
* Require:

  * named columns
  * explicit match criteria
  * bounded result scope.
* Ask a focused clarification question rather than guessing:

  * a record
  * a table
  * a matching key
  * whether the user wants one match or all matches.
* Inspect local operation facts and diagnostics before returning a response.
* A `ROW_NOT_FOUND` result must become a clarification response, not completed field mismatches.
* `MULTIPLE_ROWS_FOUND` must be clarified when one row was expected.
* Do not compare requested fields until the target row is uniquely identified.
* Preserve identifier characters exactly. For example, `O` is not `0`.
* Suggest a correction only if that exact candidate is present in workbook data.

---

## 6. Comparison and Reconciliation

* For comparison or reconciliation requests, identify the business matching key before comparing values.
* Prefer explicit user-provided keys such as:

  * Transaction Number
  * Order Number
  * Customer ID
  * Account ID
  * Invoice Number
  * Employee ID
  * Device ID
* Do not silently select an arbitrary column as the matching key.
* Match records using the identified key before comparing requested fields.
* Distinguish between:

  * changed records
  * unchanged records
  * records missing from the first dataset
  * records missing from the second dataset
  * duplicate records.
* Include only the categories explicitly requested by the user.
* If the user requests changed records only, exclude unchanged, unmatched, and duplicate records unless explicitly requested.
* Do not treat formatting differences as data changes unless the user explicitly requests formatting comparison.

---

## 7. Date and Value Normalization

* Normalize values before comparison, filtering, validation, or export whenever their representation may differ.
* Date normalization must handle:

  * Excel serial dates
  * date strings
  * date/time values
  * equivalent date representations.
* Never expose raw Excel serial numbers as final business-facing dates unless explicitly requested.
* For example, a value such as `46192` must be interpreted according to the workbook's date representation before being presented as a business date.
* Do not classify a date as changed merely because its display format differs when the underlying date value is equivalent.
* Apply appropriate normalization to:

  * whitespace
  * numeric representations
  * case when business rules permit
  * empty/null values
  * equivalent textual representations.

---

## 8. Multi-File and Multi-Sheet Analysis

* For cross-file or cross-sheet analysis:

  1. inspect each required source;
  2. identify relevant sheets and columns;
  3. apply the same business rule consistently;
  4. preserve source provenance;
  5. aggregate the required result rows;
  6. validate the consolidated result.
* Do not assume every workbook uses the same worksheet name.
* Do not assume every workbook has identical column positions.
* Map equivalent business fields using discovered headers.
* Select among the Excel MCP capabilities made available by the Copilot SDK using their advertised schemas; do not prefer a fixed tool for cross-file or cross-sheet aggregation.
* If an MCP operation is rejected or insufficient, use other supported MCP operations and aggregate only returned facts.
* Do not create unnecessary intermediate workbooks or helper sheets.

---

## 9. Result Construction

* Build the complete requested result set before creating the final output artifact.
* Keep data processing separate from final artifact creation.
* Do not use the exported workbook as an intermediate working dataset.
* Perform required:

  * joins
  * comparisons
  * filtering
  * normalization
  * calculations
  * aggregation
  * validation
    before final export whenever possible.
* Preserve source/provenance information for every reported value when required by the task.
* Do not add records, columns, calculations, or categories that the user did not request.

---

## 10. Output Construction

* When the user requests an Excel output:

  * create a clean final workbook;
  * use meaningful worksheet names;
  * include only requested columns;
  * preserve business-readable values;
  * avoid unnecessary helper columns;
  * avoid unnecessary intermediate worksheets.
* When the user requests one output sheet, create one output sheet.
* When the user requests changed records only, the final output must contain changed records only.
* Prefer writing final values directly instead of formulas when the result has already been deterministically calculated.
* Do not expose internal processing details unless requested.

---

## 11. Final Export Lifecycle

* Treat final Excel export as a terminal operation for the current request.
* Before final export:

  1. validate the complete result set;
  2. validate requested scope;
  3. validate required columns;
  4. validate values and data types;
  5. validate artifact requirements.
* Then:

  1. create the final workbook;
  2. write the final result;
  3. export the workbook;
  4. verify that the export succeeded;
  5. stop the Excel workflow.
* After successful final export, do not perform additional workbook mutations unless the user explicitly requested a post-export modification.
* Do not perform unnecessary:

  * `worksheet_transfer`
  * `copy_range`
  * `clear_range`
  * `formula_write`
  * `write_cells`
  * additional exports
    after the final artifact has been successfully created.
* Never use the final exported workbook as a temporary workspace.

Preferred lifecycle:

```text
Process
  -> Normalize
  -> Validate
  -> Build final result
  -> Export once
  -> Verify
  -> Stop
```

Avoid:

```text
Export
  -> Read
  -> Modify
  -> Copy
  -> Clear
  -> Formula
  -> Transfer
  -> Export again
```

---

## 12. Validation

* Validate outputs against:

  * the typed plan
  * source facts
  * diagnostics
  * requested scope
  * output requirements.
* Validate that:

  * required columns exist;
  * required records are present;
  * unwanted records are excluded;
  * matching rules were applied correctly;
  * dates and numeric values are normalized;
  * duplicate output rows are not introduced unexpectedly;
  * output structure matches the user's requirement.
* Validation must occur before final export whenever possible.
* Do not claim successful completion when requested-scope or artifact validation fails.

---

## 13. MCP Execution

* Use the per-session Excel MCP fallback only for clear requests the local registry cannot represent.
* Stage copies for MCP.
* Use a pre-tool policy to permit configured Excel analysis, aggregation, write, export, and conversion calls only when every input and output path stays inside staging.
* Deny:

  * shell execution
  * Python execution
  * script execution
  * custom-code execution
    when those operations are outside the permitted Excel workflow.
* When MCP fallback is selected, pursue completion through a bounded recovery loop.
* Do not stop after the first rejected tool call if a supported recovery path exists.
* Recovery must remain within the user's requested scope.
* Do not continue recovery after the requested result and final artifact have already been successfully validated.
* Once final export succeeds and artifact validation passes, terminate the Excel workflow.

---

## 14. MCP Provenance

* Label MCP output as MCP-derived and not locally verified when local verification did not occur.
* Do not claim Excel-engine calculation when an Excel engine calculation did not run.
* Retain source/provenance for reported values whenever possible.
* Ground the final response in actual MCP tool results.
* Do not invent values based on workbook metadata or tool assumptions.

---

## 15. Error Handling and Repair

* Return actionable diagnostics for:

  * malformed input
  * missing columns
  * missing worksheets
  * non-numeric values
  * invalid dates
  * duplicate keys
  * unmatched comparison rows
  * unsupported operations.
* Repair only through supported TypeScript execution paths.
* Do not repeatedly retry the same failed operation without changing the cause.
* If a tool fails, inspect the actual error before retrying.
* Do not continue blindly after a failed workbook mutation.

### Corrupted Workbook Handling

* If an output workbook reports:

  * CRC errors
  * ZIP/XML corruption
  * invalid workbook structure
  * unreadable worksheet XML
  * other workbook corruption
    then immediately stop modifying that artifact.
* Do not apply additional formulas, copies, transfers, clears, or writes to a known-corrupted workbook.
* Discard the corrupted intermediate artifact.
* Rebuild the final output from the last known-valid source data or validated result set.
* Export a fresh workbook.
* Revalidate the fresh artifact before completion.

---

## 16. Bounded Recovery

* MCP fallback recovery must be bounded.
* A recovery attempt must have a clear reason and expected result.
* Do not enter an open-ended tool loop.
* Do not continue calling tools merely because additional operations are available.
* If the requested result has been successfully produced and validated, stop.
* Return `unsupported` only after the bounded recovery attempts fail.
* The final response must answer the requested scope whenever possible.
* If completion is impossible, clearly explain the blocker and provide actionable diagnostics.

---

## 17. Efficiency

* Use the smallest number of operations necessary to complete the request reliably.
* Read only required data when practical.
* Reuse discovered metadata.
* Avoid repeated reads of unchanged data.
* Avoid repeated exports.
* Avoid unnecessary workbook mutations.
* Avoid unnecessary helper sheets.
* Prefer deterministic local processing for deterministic operations.
* Use MCP when it provides a capability the local registry cannot represent.

The goal is:

```text
minimum necessary operations
+
maximum reliability
+
complete requested scope
```

Do not optimize for fewer tool calls if doing so compromises correctness.

---

## 18. Genericity

* These rules are generic Excel-agent behavior rules.
* Do not hard-code:

  * a particular workbook name
  * a particular worksheet name
  * a particular transaction number
  * `Event Date`
  * a specific comparison scenario
  * a fixed number of input files.
* The user's current requirement determines the business logic.
* These instructions determine how that business logic should be safely inspected, planned, executed, validated, and exported.

---

## 19. Runtime Enforcement

* These are agent-behavior rules, not a replacement for runtime enforcement.
* Dynamic MCP discovery, multi-step execution, validation, recovery, export lifecycle, and repair must remain implemented in TypeScript.
* The runtime must enforce critical safety and lifecycle rules even if the model produces an incorrect plan.
* In particular, runtime enforcement should prevent:

  * unapproved paths
  * unapproved MCP tools
  * execution outside the staged workspace
  * unbounded tool loops
  * post-export mutation of a successfully completed artifact.

---

## 20. Existing Autonomous Agent

* Preserve the existing Autonomous Agent job and browser workflow.
* Do not modify unrelated autonomous-agent behavior while implementing Excel Expert capabilities.
* Excel Expert changes must remain isolated to the Excel analysis workflow unless an explicitly shared runtime capability requires modification.

---

## Core Principle

The Excel Expert Agent should behave like an experienced Excel analyst supported by deterministic automation and controlled MCP capabilities.

Always follow:

```text
Understand
    ↓
Inspect
    ↓
Plan
    ↓
Select capability
    ↓
Execute
    ↓
Normalize
    ↓
Validate
    ↓
Build final result
    ↓
Export
    ↓
Verify artifact
    ↓
STOP
```

The user's requirement determines **WHAT** needs to be done.

These rules determine **HOW** the Excel Expert Agent should reliably do it.
