---
description: Oracle Fusion Cloud Applications domain references for Java/TestNG UI automation.
applyTo: "src/**/*.java"
---

# Oracle Fusion Cloud Applications Domain Knowledge

Use this guidance when automating the Oracle Fusion Cloud Applications UI, including Redwood and Oracle JET screens.

## Phase 1 reference boundary

- Prefer official Oracle Fusion Cloud documentation and Oracle Help Center pages for functional meaning, navigation concepts, field definitions, statuses, and business rules.
- Treat database dictionary pages as domain references only. They describe data structures and do not prove that a field, label, role, or control exists in the UI.
- Use the relevant official page selectively. Extract only the fields, statuses, relationships, and workflow rules needed for the requested test case.
- Phase 2 Playwright evidence is the source of truth for current DOM structure, accessible names, frames, dialogs, and interaction behavior.

## Current reference

- [Incentive Compensation guide](https://docs.oracle.com/en/cloud/saas/incentive-compensation/oawic/index.html): Primary Phase 1 reference for Incentive Compensation workflows, including UCM/File Import and Export scenarios. Use the relevant guide topic to derive the documented workflow before live UI inspection.
- [CN_TP_TRANSACTIONS_STAGING_T](https://docs.oracle.com/en/cloud/saas/sales/oedms/cntptransactionsstagingt-13629.html#cntptransactionsstagingt-13629): Fusion Sales staging-table definition.
- Relevant concepts include transaction identifiers, participant and credited-participant data, source transaction number, transaction type, amounts and currencies, business units, processing code, object/collection/adjustment statuses, hold flags, import status, processed flag, and error message.

## UI automation rules

- Do not turn database column names into locators unless the live UI exposes the same text or an observed accessible association.
- Verify home-page navigation, Navigator, quick actions, tabs, search, tables, drawers, dialogs, and embedded flows with Playwright before coding.
- For virtualized tables, bring the target row into the rendered viewport through an observed filter or scroll action, then assert the visible result.
- Keep business assertions separate from locator mechanics: domain documentation explains what a value means; live UI evidence explains how to reach and observe it.
