---
description: Oracle OIC automation rules for Java/TestNG/Playwright work in this repository.
applyTo: "src/**/*.java"
---

# Oracle OIC automation rules

> **Scope**: repository automation files.
> Contains the enforceable contract for reliable Java/TestNG/Playwright work in this repo.

## Mandatory 3-phase workflow

Whenever you generate, modify, or review Oracle OIC automation, follow this order.

### Phase 1 — OIC domain knowledge
Before writing any automation, understand the Oracle OIC workflow and the existing project structure.

- Review the current Java/TestNG implementation in [src/main/java](../../src/main/java) and [src/test/java](../../src/test/java).
- Study the shared base classes under [src/main/java/com/oracle/oic/base](../../src/main/java/com/oracle/oic/base).
- Understand the business workflow, page flow, and expected user behavior before introducing a new test.
- Prefer the existing conventions over inventing new patterns.

### Phase 2 — UI inspection with Playwright MCP
Before emitting any locator, inspect the live UI.

- Navigate to the relevant Oracle OIC page or flow.
- Use a targeted accessibility snapshot rooted at the relevant container when possible.
- Do not capture full-page HTML or unscoped DOM dumps.
- Keep only the smallest evidence needed to identify roles, labels, text, iframe boundaries, and navigation steps.
- Extract real roles, labels, text, and structure from the UI.
- Never guess selectors or invent locators without live inspection.

### Phase 3 — Code generation
Only after phases 1 and 2 are complete:

- Implement the automation in the appropriate page object or shared helper.
- Use the locator priority ladder from [playwright-locators.instructions.md](playwright-locators.instructions.md).
- Apply the anti-flakiness guidance from [playwright-flakiness.instructions.md](playwright-flakiness.instructions.md).
- Keep automation resilient, reusable, and aligned with the existing Java/TestNG structure.

#### Mandatory BasePage reuse rules (enforced on every file change)

- Never call raw `FrameLocator` API (`frame.getByRole(...)`, `frame.getByLabel(...)`, `frame.getByText(...)`, `frame.locator(...)`) directly from a page object. Use the BasePage frame helpers: `frameGetByRole`, `frameGetByLabel`, `frameGetByText`, `frameQuery`.
- Never call `page.waitForPopup(...)` directly. Use BasePage `waitForPopup(Runnable)`.
- Never call `page.context().pages()`, `page.bringToFront()`, or any tab-switch logic directly. Use `switchToTab(index)` or `switchToNewTab()`.
- If a required BasePage helper does not yet exist, add it to `BasePage.java` first, then use it in the page object — never bypass the abstraction.
- All SQL query text, row limits, and expected result labels that appear in the Excel workbook must be read via `ExcelReader` in the test — never hard-coded in the page object.

## Source and verification expectations

Every new page object or test should include a short note explaining the workflow it targets and the evidence used to define the interaction.

Rules:
- ✅ Prefer real UI verification or the current project conventions over guessing
- ✅ Keep automation logic in page objects or shared helpers rather than inline in tests
- ✅ Use explicit waits and resilient checks instead of hard waits
- ❌ Never fabricate locators, URLs, or workflow steps

## Self-validation checklist

Before delivering code, confirm:

- [ ] OIC domain knowledge was reviewed
- [ ] UI inspection with Playwright MCP was performed when relevant
- [ ] The existing Java structure was reviewed
- [ ] The locator follows the priority ladder
- [ ] No hard waits were introduced
- [ ] The workflow is explained clearly in code comments or nearby documentation
- [ ] No raw `FrameLocator` API used in page objects — only `frameGetByRole`, `frameGetByLabel`, `frameGetByText`, `frameQuery`
- [ ] `waitForPopup`, `switchToTab`, `switchToNewTab` used instead of direct Playwright tab/popup calls
- [ ] Missing BasePage helpers were added to `BasePage.java` before use in the page object
- [ ] All workbook-driven values (SQL, row limits, expected labels) read via `ExcelReader` — not hard-coded
