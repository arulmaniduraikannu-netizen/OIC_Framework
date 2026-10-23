# Oracle OIC automation workspace

Java, TestNG, Maven, and Playwright automation for Oracle OIC. Page objects and shared browser code live in `src/main/java`; tests live in `src/test/java`.

For new automation, use `oic-domain-research` → `oic-ui-inspector` → `oic-code-generator`. Pass compact handoffs, not chat histories. Phase 2 uses Playwright MCP and is required before adding or changing a locator. No Oracle MCP server is configured.

Before writing code or suggesting implementation changes, first inspect the repository and the full `.github` folder. Read the relevant source files, page objects, tests, shared base helpers, and all applicable instruction files in `.github` before generating or proposing code. Do not guess patterns or invent new abstractions when the repository already has an established approach.

Reuse existing BasePage helpers such as `getByRole`, `getByText`, `getByLabel`, `waitForVisible`, `waitForEnabled`, and action wrappers like `click` and `fill` rather than calling Playwright `Page` APIs directly from page objects. Prefer the repository’s abstraction layer over raw `page.getBy...` usage unless there is a clear, documented reason.

For Excel requests, every natural-language prompt must be converted into an explicit ordered execution plan before tools run. The plan must name each operation, select `local-registry` or `excel-mcp`, preserve dependencies and order, and include requested exports or other outputs as steps. Execute only the planned steps, record actual local and MCP tool events, validate them against the plan and requested scope, and reject incomplete, reordered, or divergent execution rather than returning a partial success. Use clarification before planning execution when the request is ambiguous.

Excel autonomous verification flow: inspect workbook structure -> create the ordered plan -> execute deterministic local tools first -> validate diagnostics, row scope, keys, requested columns, and result representations -> recover through staged Excel MCP when local output is suspicious, incomplete, contradictory, or outside local capability -> re-run or reconcile using verified source cells -> call `excel_finish` only after the result is grounded. Never silently override deterministic facts or fabricate MCP values. Treat Excel serial dates and displayed dates as equivalent only in date-like columns; do not report a formatting-only difference as `CHANGED`, and preserve genuine numeric changes. MCP recovery is bounded, path-restricted, provenance-aware, and must end as verified MCP output, clarification, or unsupported with the actual blocker.

Mandatory Phase 3 reuse rules (enforced before every code change):
- Never call raw `FrameLocator` API (`frame.getByRole(...)`, `frame.getByLabel(...)`, `frame.getByText(...)`, `frame.locator(...)`) directly from a page object. Use BasePage frame helpers: `frameGetByRole`, `frameGetByLabel`, `frameGetByText`, `frameQuery`.
- Never call `page.waitForPopup(...)` directly. Use BasePage `waitForPopup(Runnable)`.
- Never call `page.context().pages()`, `page.bringToFront()`, or tab-switch logic directly. Use `switchToTab(index)` or `switchToNewTab()`.
- If a required BasePage helper does not yet exist, add it to `BasePage.java` first, then use it in the page object — never bypass the abstraction.
- All SQL query text, row limits, and expected result labels that appear in the Excel workbook must be read via `ExcelReader` in the test, not hard-coded in the page object.
Phase 2 must produce a concrete locator contract before Phase 3 starts: record the observed role, visible text/label, expected step sequence, and any fallback locator that was seen in the live UI. Phase 3 must implement code from that contract, not from assumptions. After implementation, run the focused test and verify the locator against the live page; if it fails, classify it as `LOCATOR_DRIFT`, `LOCATOR_AMBIGUOUS`, `TIMING`, or `NAVIGATION` and adjust before considering the work complete.

Follow scoped instruction files for locator, flakiness, verification, domain, and Git rules. Reuse base classes, externalize environment data, avoid hard waits and brittle primary CSS/XPath locators, and never expose secrets.

Locator contract requirements:
- Record the accessible role, accessible name, exact-match setting, owning container, and observed match count.
- Treat visual position such as "second column" as evidence only; never use it as locator identity.
- Do not use `.first()` or `.nth()` unless live evidence proves multiple matches and documents why that element is correct.
- Prefer a named semantic locator scoped to the verified container over redundant text filters or positional selectors.
- A manual click or live inspection does not complete Phase 3; the focused automated test must run and pass before the locator is considered verified.

After any test run, report failures directly with their classification before proposing or applying fixes. Do not automatically fix failed tests; wait for the user's explicit approval before changing code in response to a failure.
