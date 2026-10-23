# Oracle Fusion Java/Playwright automation

Stack: Java, TestNG, Maven, Playwright. Page objects live in
`src/main/java`; tests live in `src/test/java`; config and credentials stay
external and are never printed or committed.

For new Fusion UI automation use:
`oic-domain-research` -> `oic-ui-inspector` -> `oic-code-generator`.
Pass compact handoffs, not chat histories or full snapshots. Phase 2 live
Playwright evidence is required before adding or changing a locator.

Before writing code or providing implementation suggestions, always read the
repository and the entire `.github` folder first. Review the relevant source
files, page objects, tests, shared base helpers, and instruction files in
`.github` before generating or recommending code. Do not guess a pattern when
an existing repo convention is available.

For Excel and workbook requests, require a first-class ordered execution plan
before any tool call. The plan must identify each operation, explicitly route
it to `local-registry` or `excel-mcp`, preserve dependencies and order, and
include export or other requested-output steps. Record actual tool events and
validate them against the plan, workbook scope, diagnostics, and artifacts.
Never report success when a required step is missing, reordered, or divergent;
ask clarification before execution when the request is ambiguous.

Excel autonomous verification flow: inspect workbook structure, plan the exact
ordered steps, execute deterministic local tools first, validate diagnostics and
requested scope, and inspect representations before completion. If output is
suspicious, incomplete, contradictory, or outside local capability, recover
through the staged Excel MCP, read the relevant source cells, then re-run or
reconcile the deterministic operation before calling `excel_finish`. Never
fabricate or silently override facts. Excel serial dates and displayed dates
are equivalent only for date-like columns, so formatting-only differences must
not become `CHANGED` while genuine numeric date changes remain changes. MCP
recovery is bounded, path-restricted, and provenance-aware; finish only with
verified local/MCP output, clarification, or a concrete unsupported blocker.

MANDATORY: Never add, edit, or delete any code or file in this repository
without the user's explicit approval first. Always present the exact proposed
change (files, diff, or full new content) and wait for the user to approve it
before applying any edit. Running tests, browsers, and read-only investigation
does not require approval.

Reuse the existing BasePage helper methods such as `getByRole`, `getByText`,
`getByLabel`, `waitForVisible`, `waitForEnabled`, and action wrappers like
`click` and `fill` instead of calling Playwright `Page` APIs directly from
page objects. Prefer the repository’s abstraction layer over raw
`page.getBy...` usage unless there is a clear, documented reason.

This chain is mandatory for `/oic-test` and must run in order with no shortcuts.
Do not jump directly to Phase 3.

For new-work planning, use the reusable
[`plan-oic-automation` prompt](.github/prompts/plan-oic-automation.prompt.md)
to record scope, handoffs, locator evidence, validation, and lifecycle risks
before implementation.

Phase 2 must produce a concrete locator contract before Phase 3 begins:
record the observed role, visible text/label, expected step sequence, and any
fallback locator seen in the live UI. Phase 3 must translate that contract
into code and verify the implementation against the live page before the work is
considered complete. If the runtime check fails, classify it as
`LOCATOR_DRIFT`, `LOCATOR_AMBIGUOUS`, `TIMING`, `NAVIGATION`, `REAL_BUG`, or
`ENV` and adjust the locator before proceeding.

MANDATORY lazy-rendered table verification: Before classifying a result locator
as missing or changing it, inspect and scroll every relevant internal table or
results container to its end so lazy-rendered rows are loaded. Then verify the
exact requested transaction link and open its matching details panel. Do not
substitute a suffixed or prefix-matching transaction number when the requested
exact transaction is available.

Phase gates (mandatory):
- Gate A (before Phase 2): Phase 1 handoff must include Oracle-doc-derived ordered workflow steps, expected observable outcomes, the Oracle Applications Common baseline URL (https://docs.oracle.com/en/cloud/saas/applications-common/), at least one scenario-specific Oracle source URL, and unresolved questions.
- Gate B (before Phase 3): Phase 2 handoff must include a concrete locator contract for each step: observed role, visible text/label, expected step sequence, and fallback locator when observed.
- Gate C (before completion): Phase 3 must include changed files and focused Maven validation evidence.

If any gate fails, stop and report exactly what is missing. Never guess or backfill missing evidence.

Locator contract requirements:
- Record the accessible role and accessible name, including whether name matching is exact.
- Record the owning container or table and the observed match count.
- Treat visual position such as "second column" as evidence only, never as locator identity.
- Do not use `.first()` or `.nth()` unless live evidence proves multiple matches and documents why that element is correct.
- Prefer the named semantic locator, scoped to the verified container, over a text filter or positional selector.
- After implementation, run the focused test before declaring Phase 3 complete. A successful manual click is not sufficient.

Use page objects and `BasePage` helpers. Locator order is role, label,
placeholder, text, alt text, title, test id, then documented CSS/XPath fallback.
Use strict locators, web-first state waits, externalized data, and configured
timeouts. Never use hard waits, polling loops, inline secrets, or guessed
locators. If evidence is unavailable, stop and report it.

Before classifying a UI action as successful or proposing a locator fix, verify
the resulting state using a live locator, URL/page/tab change, or run-specific
DOM or screenshot evidence. A click completing without an exception does not
prove that the intended transition occurred. Clearly separate observations
from hypotheses and run the cheapest discriminating check before editing.

For test runs compile first with `mvn -q -DskipTests compile`, then run the
focused Maven filter. For failures classify `LOCATOR_DRIFT`,
`LOCATOR_AMBIGUOUS`, `TIMING`, `NAVIGATION`, `REAL_BUG`, or `ENV` before fixes.
After any test run, report the failure and its classification directly before
proposing or applying any fix. Do not change code automatically after a
failure; wait for the user's explicit approval to fix it.
Use lowercase branch prefixes and Conventional Commits; never push, stage,
commit, rebase, or delete files unless explicitly requested.
