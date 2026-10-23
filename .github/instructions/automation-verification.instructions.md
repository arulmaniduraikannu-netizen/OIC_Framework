---
description: General verification rules for new Java/Playwright automation in this repository.
applyTo: "src/**/*.java"
---

# Automation verification rules

> **Scope**: repository automation files.
> Contains the enforceable contract for reliable Java/Playwright automation work in this repo.

## Required workflow for new automation

1. Review the existing Java/TestNG structure before introducing new tests or helpers.
2. Prefer the shared base classes under [src/main/java/com/oracle/oic/base](../../src/main/java/com/oracle/oic/base) when adding new setup logic.
3. Verify the relevant UI or workflow state before introducing a new locator.
4. Apply the locator priority ladder from [playwright-locators.instructions.md](playwright-locators.instructions.md).
5. Apply the anti-flakiness guidance from [playwright-flakiness.instructions.md](playwright-flakiness.instructions.md).

## Source and verification expectations

Every new page object or test should include a short note explaining the workflow it targets and the evidence used to define the interaction.

Rules:
- ✅ Prefer real UI verification or the current project conventions over guessing
- ✅ Keep automation logic in page objects or shared helpers rather than inline in tests
- ✅ Use explicit waits and resilient checks instead of hard waits
- ❌ Never fabricate locators, URLs, or workflow steps

## Phase 3 locator gate

Before implementing a locator from live UI evidence, record a concrete locator contract:

- accessible role and accessible name
- exact-match setting
- owning container or table
- observed match count
- expected step sequence
- verified fallback locator, if one exists

Treat visual position such as "second column" as evidence only. Do not use `.first()` or
`.nth()` unless live evidence proves multiple matches and documents why the selected match
is correct. Prefer the named semantic locator scoped to the verified container.

After implementation, run the focused automated test. If it fails, classify the failure as
`LOCATOR_DRIFT`, `LOCATOR_AMBIGUOUS`, `TIMING`, `NAVIGATION`, `REAL_BUG`, or `ENV` before
proposing a change.

## Self-validation checklist

Before delivering code, confirm:

- [ ] The existing Java structure was reviewed
- [ ] The locator follows the priority ladder
- [ ] No hard waits were introduced
- [ ] The workflow is explained clearly in code comments or nearby documentation
