---
description: Create an evidence-based implementation plan for an Oracle Fusion Java/TestNG Playwright automation task
argument-hint: Oracle Fusion workflow, expected outcome, and any known failing behavior
---

# Plan Oracle Fusion Automation: ${input:scenario}

Create a formal implementation plan for **${input:scenario}**. This prompt plans work only; do not change Java code, locators, configuration, or test data.

Follow the repository workflow and rules in [AGENTS.md](../../AGENTS.md), [intune-test-rules.instructions.md](../instructions/intune-test-rules.instructions.md), and [automation-verification.instructions.md](../instructions/automation-verification.instructions.md).
Use [the ADLC automation reference](../adlc-automation.md) to assess build, test,
deploy, monitor, iterate, and governance concerns for the planned workflow.

## Required research and handoffs

Plan the task around the required agent sequence:

1. `oic-domain-research`: repository and Oracle-domain workflow evidence.
2. `oic-ui-inspector`: live Playwright evidence and a locator contract.
3. `oic-code-generator`: smallest page-object and test changes based on the verified evidence.

Do not plan locator changes from assumptions. State which phase gate is currently unmet and what evidence is needed to satisfy it.

## Required output

Use this exact outline. Replace every placeholder with task-specific information or `Unknown - requires evidence`.

### Objective
- Workflow under test:
- Expected business outcome:
- Success criteria:

### Scope
- Included:
- Excluded:
- Dependencies and prerequisites:

### Repository Context
- Relevant page objects, tests, base helpers, and configuration reviewed:
- Existing patterns to reuse:
- Applicable repository instructions:

### Phase 1: Domain and Workflow Research
- Ordered business workflow:
- Oracle Applications Common baseline URL:
- Scenario-specific Oracle source URL:
- Expected observable outcomes:
- Open questions:

### Phase 2: UI Inspection and Locator Contract
For each UI interaction, record:

| Step | Page or dialog | Observed role | Visible text or label | Expected state transition | Observed fallback locator |
|---|---|---|---|---|---|
| 1 | | | | | |

- Evidence status: `Pending live inspection` or `Verified`
- Locator risks or ambiguity:

### Phase 3: Implementation
1. Page-object change:
2. Shared helper or configuration change:
3. Test change:
4. Assertion and cleanup behavior:

### Files Expected to Change
- 

### Verification Plan
1. Compile: `mvn -q -DskipTests compile`
2. Focused test: `mvn -q -Dtest={TestClass} test`
3. Live locator verification and expected evidence:
4. Failure classification if validation does not pass: `LOCATOR_DRIFT`, `LOCATOR_AMBIGUOUS`, `TIMING`, `NAVIGATION`, `REAL_BUG`, or `ENV`

### Lifecycle and Governance Notes
- Build: smallest maintainable change and shared abstractions used.
- Test: representative behavior and assertions to validate.
- Deploy: required tenant, account, test data, or environmental preconditions.
- Monitor: traces, screenshots, downloads, or reports to inspect after execution.
- Iterate: likely edge cases to turn into future regression coverage.
- Govern: credentials, tool access, download handling, and human approval boundaries.

### Gate Status
- Gate A - Phase 1 evidence:
- Gate B - Phase 2 locator contract:
- Gate C - changed files and focused Maven validation:

### Decision Log
- Decisions made and evidence supporting them:
- Explicitly deferred work:
