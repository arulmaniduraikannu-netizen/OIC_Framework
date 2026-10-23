---
description: Research an Oracle Fusion Cloud Applications workflow and repository conventions without loading browser tools.
argument-hint: Oracle Fusion Cloud Applications workflow or scenario to research
tools:
  - codebase
  - search
  - githubRepo
  - githubTextSearch
  - memory
---

# Oracle Fusion Domain Research

Research Phase 1 only for Oracle Fusion Cloud Applications UI automation. Do not inspect the live browser and do not generate or edit automation code.

## Phase 1 objective

- Produce an Oracle-doc-backed test-case flow that Phase 2 can inspect directly.
- Prepare a compact handoff that leaves Phase 2 enough context to capture a concrete locator contract.
- Do not produce locators.
- Do not open browser tools.

## Procedure

1. Read the relevant page objects, tests, `BasePage`, `BaseTest`, and `PlaywrightFactory`.
2. Identify the exact Oracle Fusion module and work area for the requested scenario.
3. Query official Oracle documentation first and capture source URLs used for the workflow. Always include the Oracle Applications Common baseline URL: https://docs.oracle.com/en/cloud/saas/applications-common/
4. For Incentive Compensation and UCM/File Import and Export scenarios, begin with the official [Incentive Compensation guide](https://docs.oracle.com/en/cloud/saas/incentive-compensation/oawic/index.html), then identify the most relevant topic within that guide.
5. Extract ordered user workflow steps from Oracle sources and convert them to test-case steps with action and expected observable outcome.
6. Build a Phase 2 inspection checklist mapped per step, including target screen state, control type, candidate visible labels to verify live, ambiguity notes, and the exact evidence Phase 2 should capture for the next implementation step.
7. For transaction-domain references, consult [CN_TP_TRANSACTIONS_STAGING_T](https://docs.oracle.com/en/cloud/saas/sales/oedms/cntptransactionsstagingt-13629.html#cntptransactionsstagingt-13629) only for field meanings, statuses, relationships, and processing concepts.
8. Never treat database column names as UI locators. Record them as domain concepts that Phase 2 must map to observed UI text or accessible properties.
9. Return a handoff of at most 20 bullets for the UI inspection phase with scenario, preconditions, Oracle sources, ordered test-case steps, reusable symbols, per-step inspection targets, and unresolved questions.

## Gate A contract (must pass before Phase 2)

Phase 1 is considered complete only if all items below are present in the handoff:

1. Includes Oracle Applications Common baseline URL: https://docs.oracle.com/en/cloud/saas/applications-common/
2. Includes at least one scenario-specific Oracle source URL in addition to the baseline.
3. Provides ordered test-case steps derived from Oracle docs, each with:
  - action
  - expected observable outcome
  - source reference mapping
4. Lists unresolved questions or explicit `none`.

If any item is missing, return `GATE_A_FAIL` with missing fields and do not produce a Phase 2-ready handoff.

## Required handoff shape

1. Scenario and preconditions
2. Oracle source URLs
3. Ordered test-case steps (action + expected outcome)
4. Phase 2 inspection targets per step
5. Reusable repo files and Java symbols
6. Open questions or blockers
7. Required Phase 2 evidence to capture: role, visible text/label, expected step sequence, and fallback locator if observed

## Constraints

- Do not use Playwright or browser tools.
- Oracle documentation is mandatory when scenario behavior is unclear.
- Do not invent URLs, locators, roles, labels, or workflow steps.
- Prefer a concise evidence handoff over reproducing large source files.
- Never mark Phase 1 complete when Oracle-doc-derived ordered steps are missing.
