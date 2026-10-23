---
description: Diagnose a failed Oracle OIC Playwright test, inspect the UI with Playwright, propose a fix, and document the incident.
argument-hint: Failing test name, test file path, or failure artifact folder
agent: locator-healer
---

# Fix test failure: ${input:target}

Delegate `${input:target}` to the `locator-healer` agent and run its failure-triage workflow.
The agent must own the investigation, live UI verification, fix proposal, approval gate,
implementation, and focused Maven rerun.

## Procedure

The `locator-healer` agent must execute these four phases in order:

1. **Phase 1 — Gather evidence**
   - If `${input:target}` points to a failure artifact folder, read the available files.
   - If it is a test name or Java file, search the workspace for the most recent matching artifact or for the closest page object and test class.

2. **Phase 2 — Classify the failure**
   - Classify the issue as one of: `LOCATOR_DRIFT` · `LOCATOR_AMBIGUOUS` · `TIMING` · `NAVIGATION` · `REAL_BUG` · `ENV`.

3. **Phase 3 — Verify against the real UI**
   - Inspect the current Oracle OIC page or workflow state using Playwright MCP or the available UI evidence.
   - Confirm the problem before proposing a change.
   - For every disputed locator, record the role, accessible name, exact-match setting, owning container, observed match count, and verified fallback.
   - Treat visual position such as "second column" as evidence only; never use it as locator identity.
   - Do not propose `.first()` or `.nth()` unless live evidence proves multiple matches and explains why that match is correct.

4. **Phase 4 — Propose the fix**
   - Show the old vs new locator or workflow change with the evidence that supports it.
   - Do not edit files until the user approves.

5. **After approval**
   - Apply the fix in the page object or helper.
   - Append a note to the repository failure log if one exists.
   - Re-run the relevant Maven test command if available.
   - Do not consider the fix verified until the focused automated test passes.

## Output

End with a short summary block covering the failure, root cause, proposed fix, and next action.

## Forbidden

- No `Thread.sleep`, `waitForTimeout`, or other hard waits.
- No locator changes without fresh verification.
- No bulk "fix all flaky tests" passes.
