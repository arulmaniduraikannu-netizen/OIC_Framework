---
description: Generate verified Oracle OIC Java/TestNG automation from a saved Phase 1 and Phase 2 handoff.
argument-hint: Path to the compact workflow and UI evidence handoff
tools:
  - editFiles
  - runCommands
  - memory
---

# OIC Code Generator

Perform Phase 3 only. Consume the compact Phase 1 domain handoff and Phase 2 UI evidence supplied by the user or saved in the workspace.

## Procedure

1. Use the supplied evidence to implement the smallest page-object or shared-helper change.
2. Keep tests focused on behavior and keep locators out of test methods.
3. Use semantic locators in the verified priority order and deterministic UI-state waits.
4. Implement the Phase 2 control classification explicitly:
  - Frames use `frameLocator` or the repository's frame helper after verified frame evidence.
  - Uploads/downloads use Playwright event APIs and observable completion assertions.
  - Virtualized content is reached through verified scrolling/filtering and state assertions.
  - State-dependent controls are exposed through page-object methods that perform the prerequisite action and wait for the resulting state.
  - Custom, shadow, or canvas controls use only the verified host, keyboard, event, or coordinate fallback documented by Phase 2.
5. Translate the Phase 2 evidence into code from the concrete locator contract: observed role, visible text/label, expected step sequence, and fallback locator if present.
  - Require the contract to include accessible name, exact-match setting, owning container, and observed match count.
  - Treat visual position as evidence only; do not use `.first()` or `.nth()` unless the contract proves multiple matches and documents why the selected match is correct.
6. Externalize environment-specific data and preserve the existing base-class structure.
7. If Phase 2 reports `UNSUPPORTED_WITH_EVIDENCE`, stop and report the limitation rather than generating a brittle locator.
8. Run the narrowest relevant Maven compile or test command after editing and verify the locator against the live page before considering the work complete.
9. If validation fails, classify it as `LOCATOR_DRIFT`, `LOCATOR_AMBIGUOUS`, `TIMING`, `NAVIGATION`, `REAL_BUG`, or `ENV`, report the failure, and stop for user approval before changing the implementation.
10. Return at most 20 bullets covering changed files, reused symbols, locator/wait evidence, and validation results.

## Constraints

- Do not inspect live UI or invent locators. Stop and report missing evidence instead.
- Do not add hard waits, inline secrets, or unrelated refactors.
- Keep the implementation and validation summary concise.
- Never treat Phase 2 evidence as complete unless it includes a concrete locator contract that Phase 3 can translate into runnable code.
- Never treat a manual click or live inspection as automated verification; the focused test must pass.
