---

name: excel-expert

description: "Use for arbitrary Excel analysis, transformation, comparison, validation, aggregation, and reporting in the OIC Copilot Runner."

---

# Excel Expert Skill

Use this skill when the user asks to inspect, analyze, compare, transform, validate, aggregate, or report on CSV, XLSX, or ZIP workbook inputs.

## Core principle

Use deterministic workbook operations whenever the requested analysis can be represented by the local Excel operation registry.

Use Copilot for interpreting the user's natural-language requirement, selecting an appropriate operation plan, asking focused clarification questions, and explaining already-computed results.

Do not use the model to perform deterministic row matching, date comparison, arithmetic, aggregation, or other workbook calculations that can be executed by the local registry.

## Analysis workflow

For each Excel request:

1. Inspect the available workbook structure and capability facts.

2. Interpret the user's request into a typed execution plan containing:

   * target workbook, file, and sheet/table
   * exact source columns
   * match/join criteria
   * requested comparison or transformation
   * requested output columns
   * row scope: one row or all matching rows
   * requested output artifact, if any

3. Resolve ambiguity before execution.

   * Do not guess a sheet, table, column, identifier, or row scope.
   * Ask a focused clarification question when required information is missing.

4. Prefer deterministic local operations when they can represent the request.

5. Use Excel MCP only as a bounded fallback when the local operation registry cannot represent the clear request and the runtime permits the operation.

6. Execute the selected operations and preserve source facts, diagnostics, and provenance.

7. After each result, reassess the original request against all accumulated deterministic results. Continue only for an explicitly requested operation or output that remains unsatisfied, a requested artifact that is still pending, or a safe repair needed because diagnostics make requested work incomplete. If the requested work is satisfied and there are no unresolved errors or pending artifact steps, stop and complete. Do not add speculative discovery, lookup, filtering, validation, export, or MCP calls merely to inspect, reshape, or verify an already sufficient result.

8. Validate the result against:

   * the user's requested scope
   * the execution plan
   * workbook structure
   * operation diagnostics
   * requested output fields

9. If a supported operation can be repaired safely, repair and validate again. Do not fabricate missing results.

10. Return the result with its source clearly identified:

   * deterministic local result
   * MCP-derived result
   * clarification required
   * unsupported/error

## Available deterministic operations

### `filter`

Select rows using a named column and value or supported predicate.

### `lookup`

Match rows using named filters and return explicitly requested columns.

Use exact workbook column names and explicit match criteria.

### `group`

Group rows and calculate supported deterministic aggregations such as counts and sums.

### `compare`

Compare or join datasets using an explicitly named key.

Report supported comparison states such as:

* MATCH
* MISMATCH
* MISSING

Do not silently change the join key or comparison semantics.

### `validate`

Check workbook structure and data-quality conditions such as:

* required columns
* duplicate keys
* malformed or missing values
* incompatible data

Additional operations may be available through the runtime registry. Prefer registry capability discovery over assuming that this list is exhaustive.

## Generic Excel requirements

Do not hard-code a particular workbook layout or business scenario.

The same workflow must support requirements such as:

* comparing two workbooks
* comparing multiple workbooks
* finding changed values
* finding missing records
* cross-sheet matching
* cross-file matching
* filtering records
* grouping and aggregation
* validating duplicate identifiers
* extracting selected fields
* producing an XLSX report
* analyzing CSV or ZIP inputs

Do not modify this skill for each new user requirement.

The user request should determine the execution plan and operation parameters.

## Data integrity

Never infer a column from visual position.

Always use workbook-discovered names and structures.

Do not silently discard malformed rows.

Do not let the model recalculate deterministic result values.

Preserve identifiers exactly.

For example:

`-CO` contains the letter `O`.

`-C0` contains the digit `0`.

Do not silently autocorrect identifiers.

If an identifier is not found, report the lookup result and allow the runtime to determine whether clarification is required.

## Dates and numeric values

Preserve workbook value semantics during analysis.

Do not expose Excel serial numbers such as `46192` as a user-facing date when the source column represents a date.

When producing output, preserve the source date representation where possible or convert it to an appropriate human-readable date representation according to the workbook's actual date semantics.

Do not change a value merely for presentation if doing so would alter its meaning.

## Changed-record analysis

When the user asks for changed records:

* identify the explicit comparison key
* identify the explicit comparison field(s)
* compare the corresponding records deterministically
* return only records where the requested value actually changed
* exclude unchanged records unless requested
* distinguish changed, missing, and unmatched records according to the user's request
* preserve the requested output fields

If the user requests an Excel output and does not request multiple sheets, prefer a single output sheet containing the requested result rows.

Do not include helper columns, diagnostic rows, workbook metadata, or unchanged records unless requested.

## Output artifacts

When an XLSX/CSV output is requested:

* create the artifact through the supported runtime operation
* preserve the requested result scope
* validate that the artifact exists and contains the expected result
* ensure headers and requested columns are present
* ensure date values are represented correctly
* do not report an export as successful if artifact validation failed

Artifact creation and validation are runtime responsibilities.

## MCP fallback

Excel MCP is a fallback capability, not the default execution path.

The configured MCP server is:

`mbeps/excel-mcp`

MCP execution is limited to the runtime's staged-path policy.

Inputs and generated outputs must remain inside the permitted staging area.

Shell, Python, arbitrary scripts, and custom-code execution are not permitted through the Excel MCP fallback.

For whole-workbook, cross-file, or cross-sheet requests:

1. Select among the Excel MCP capabilities made available by the Copilot SDK using their advertised schemas; do not prefer a fixed tool.
2. If a capability cannot satisfy the request, use other supported MCP operations for the required files or sheets.
3. Aggregate the returned facts through the supported runtime path.
4. Continue only within the runtime's bounded recovery policy.

Do not claim that an MCP-derived result was independently verified locally unless local verification actually occurred.

## Separation of responsibilities

The skill defines reusable Excel-analysis behavior and methodology.

It does not implement:

* dynamic MCP discovery
* tool execution
* staged-file enforcement
* timeout handling
* session recovery
* operation registry implementation
* artifact creation
* artifact validation
* runtime event tracking

Those responsibilities belong to the TypeScript runtime.

The agent and prompt may instruct the workflow, but the runtime is the final enforcement layer.
