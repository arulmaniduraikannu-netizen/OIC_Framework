---
description: Verify Playwright locators with compact live UI evidence using Playwright MCP
argument-hint: Path to test or page-object file to verify
---

# Verify locators: ${input:filePath}

Run a compact live verification of the locators in `${input:filePath}` using Playwright MCP.

## Procedure

Follow the same evidence-first flow as the other OIC prompts:

1. **Read the file** at `${input:filePath}` and extract every Playwright locator.
2. **Group by page** — note which Oracle Fusion page or workflow each locator belongs to.
3. For each page:
   a. Inspect the current UI state with Playwright MCP.
   b. Capture one targeted accessibility snapshot for the relevant container or frame.
   c. For each locator on this page, verify it appears in the UI evidence.
   d. Record: ✅ verified, ⚠️ ambiguous (matches multiple), or ❌ not found.

## Report format

Output a table:

| Locator | Page | Status | Notes |
|---|---|---|---|
| `getByRole(button, "Add")` | /apps | ✅ verified | Snapshot 2026-06-07 |
| `getByLabel("Name")` | /apps/new | ⚠️ ambiguous | Matches 2 elements — needs a verified owning-container scope |
| `locator(".btn-primary")` | /apps | ❌ not found | Element no longer exists |

## On failure

For each ❌ or ⚠️:
2. Re-snapshot only the relevant container or frame
3. Suggest a corrected locator from the priority ladder
4. Show the diff (old vs new)
5. Propose an update to the relevant repository note or knowledge artifact; do not edit it without approval.

## Final summary

- Total locators: N
- Verified: X
- Ambiguous: Y
- Not found: Z
- File ready for commit: yes / no

Keep the report under 20 bullets and never include full-page HTML or unchanged snapshots.
