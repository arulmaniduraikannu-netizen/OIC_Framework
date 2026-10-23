---
description: Detailed Agent Development Lifecycle reference for Oracle Fusion Java/TestNG Playwright automation planning, delivery, and continuous improvement
---

# Agent Development Lifecycle for OIC Automation

This reference applies the Agent Development Lifecycle (ADLC) to the Oracle Fusion automation in this repository. It explains the operating loop behind the repository rules. [AGENTS.md](../AGENTS.md) and the scoped files in [instructions](instructions/) remain the source of enforceable requirements.

## The Operating Loop

Reliable automation is not a one-time test-generation activity. Each workflow follows:

`Build -> Test -> Deploy -> Monitor -> Iterate`, with governance across every phase.

For a new Oracle Fusion workflow, use the required agent sequence:

1. `oic-domain-research` for the business workflow and repository context.
2. `oic-ui-inspector` for live Playwright evidence and locator contracts.
3. `oic-code-generator` for the smallest evidence-based implementation and Maven validation.

Use [plan-oic-automation.prompt.md](prompts/plan-oic-automation.prompt.md) before implementation when the workflow is new, broad, risky, or needs a recorded decision trail.

## Build

Build defines the automation behavior and its maintainable structure.

- Research the Oracle Fusion workflow, prerequisites, and expected result before editing code.
- Record a locator contract from the live UI: role, visible text or label, state transition, and observed fallback when needed.
- Put interactions in page objects under `src/main/java`; keep TestNG tests focused on the business scenario.
- Reuse `BasePage` helpers such as `getByRole`, `getByText`, `getByLabel`, `waitForVisible`, `waitForEnabled`, `click`, and `fill`.
- Externalize tenant-specific data and credentials; do not place secrets in source or notes.

Example: a File Import and Export workflow needs a verified path from Fusion home to the import/export page, an account-selection contract, a search-result signal, and a download action. The test should consume a configured account and file name rather than rely on an unverified UI assumption.

## Test

Test turns the intended workflow into repeatable proof of behavior.

- Start with a representative TestNG scenario and a business-level assertion.
- Verify observable outcomes, such as a result row, completed process state, or saved download, instead of only checking that clicks did not throw errors.
- Prefer web-first waits tied to visible or enabled UI state. Never add hard waits or polling loops.
- Preserve difficult real examples: locator ambiguity, slow dialogs, required approvals, and known tenant-specific conditions should become focused regression coverage.
- Compile first with `mvn -q -DskipTests compile`, then run the narrow Maven test filter.

Example: after downloading an export file, assert that the requested file exists in the configured test-results download folder and that the correct result was present before the download action.

## Deploy

Deploy makes the automated workflow runnable in the intended environment.

- Identify required tenant, user role, environment configuration, data fixtures, and file-system paths.
- Confirm that the execution user has only the permissions needed for the scenario.
- Treat state-changing actions, such as submitting processes or downloading sensitive business data, as explicit prerequisites in the test plan.
- Keep CI and local execution behavior consistent: use configuration, Maven parameters, and repository-managed test data rather than machine-specific values.

Example: an account-specific File Import and Export test requires a valid authenticated Fusion user, an account visible to that user, an expected file in the tenant, and a writable download directory.

## Monitor

Monitor explains what happened in actual execution and makes failure diagnosis possible.

- Review Surefire/TestNG reports, screenshots, download artifacts, and test logs after focused runs.
- Capture enough evidence to reconstruct the failed interaction: current page or dialog, intended locator, observed UI state, and final assertion outcome.
- Classify every runtime failure before changing code:
  - `LOCATOR_DRIFT`: the verified locator no longer matches the live UI.
  - `LOCATOR_AMBIGUOUS`: multiple elements match and intent is unclear.
  - `TIMING`: the expected state was not ready within the configured wait.
  - `NAVIGATION`: the test reached the wrong page, dialog, or route.
  - `REAL_BUG`: the application behavior violates the intended business result.
  - `ENV`: tenant, credentials, configuration, data, or infrastructure prevented execution.

Example: if a download control is missing after search, retain the screenshot and report whether the result itself was absent, the page navigated away, or the UI changed, instead of immediately replacing the locator.

## Iterate

Iterate converts evidence from runs into a better next version.

- Add a failing locator or workflow condition to the relevant plan before changing the page object.
- Reinspect the live UI when the failure is `LOCATOR_DRIFT` or `LOCATOR_AMBIGUOUS`; never guess a replacement selector.
- Convert recurring timing, data, and navigation failures into explicit preconditions, state checks, or regression cases.
- Keep successful workflow and locator evidence compact and reusable for future related tests.

Example: if the File Import and Export results load asynchronously, verify the result grid or requested file row before exposing the download action; do not hide the issue with a fixed delay.

## Govern

Governance surrounds every stage so automation remains safe, explainable, and reusable.

- Preserve the Phase A, B, and C gates defined in [AGENTS.md](../AGENTS.md): domain evidence, live locator contracts, and focused Maven validation.
- Keep credentials external and avoid recording sensitive downloaded data in documentation or version control.
- Require human review or explicit approval for irreversible or high-impact actions, including production data changes, financial actions, and broad deletions.
- Keep shared rules in `AGENTS.md` and `.github/instructions`; record durable workflow knowledge in repository documentation and active task evidence in the plan.
- Use a clear audit trail: files changed, evidence source, validation command, result, and failure classification.

## Completion Checklist

- [ ] Business workflow and expected observable outcome are documented.
- [ ] Live UI locator contract is recorded for every changed interaction.
- [ ] Page objects use repository helper abstractions.
- [ ] Preconditions, environment data, and permissions are explicit.
- [ ] Focused compile and test results are recorded.
- [ ] Failure evidence is classified before any locator change.
- [ ] New durable findings are captured for the next automation task.
