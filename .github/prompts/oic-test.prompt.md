---
description: Generate a verified Java/TestNG Playwright test for an Oracle Fusion Cloud Applications workflow
argument-hint: Oracle Fusion page, workflow, and expected outcome (e.g. "Run VSA Jobset process" or "Manage Transactions search")
agent: oic-test-generator
---

# Oracle Fusion UI test: ${input:scenario}

This is a thin parameterized launcher. The actual rules and procedure live in:

- **Workflow & rules** → [intune-test-rules.instructions.md](../instructions/intune-test-rules.instructions.md)
- **Templates & domain knowledge** → [intune-test-author skill](../skills/intune-test-author/SKILL.md)
- **Persona & tools** → already active via `agent: oic-test-generator` above

## Required chained execution (no shortcuts)

For every `/oic-test` run, execute these agents strictly in order and stop on any missing evidence:

1. `oic-domain-research` — Phase 1 repository/domain handoff
2. `oic-ui-inspector` — Phase 2 live Playwright locator contract handoff
3. `oic-code-generator` — Phase 3 code generation + Maven validation

Do not jump directly to Phase 3. If Phase 1 or Phase 2 handoff is incomplete, stop and report the gap.

## Locator contract gate

Phase 2 must record, for every interaction, the accessible role, accessible name,
exact-match setting, owning container or table, observed match count, expected step
sequence, and any verified fallback locator. Visual position such as "second column"
is evidence only and must not become a positional locator. `.first()` and `.nth()` are
allowed only when the live evidence proves multiple matches and documents the selected
match. Phase 3 must run the focused automated test before the locator is considered verified.

## Run it

Generate the test for **`${input:scenario}`** by following the 3-phase workflow defined in `intune-test-rules.instructions.md`:

1. Phase 1 — Repository context + Oracle domain knowledge
2. Phase 2 — Playwright MCP snapshot + verified locator extraction
3. Phase 3 — Smallest Java/TestNG page-object change + Maven validation

Use the **Output shape** from the agent persona for the response.

## Argument

`${input:scenario}` — Oracle Fusion Cloud Applications workflow and expected outcome.
