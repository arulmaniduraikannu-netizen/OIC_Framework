---
description: Branch naming, commit message format, and PR rules for the Oracle OIC Java/Playwright project. Auto-loaded for source files so any agent that writes code knows the workflow conventions.
applyTo: "{src/**/*.java,pom.xml,testng.xml,.github/**/*.{java,xml,yml,yaml,md}}"
---

# Git Workflow Rules

> The single source of truth for **branches, commits, and PRs** on this repo.
> Cross-referenced from the repo automation workflow. Don't duplicate.

## Branch naming (required)

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New automation flow, page object, or test | `feat/oic-manage-transactions` |
| `fix/` | Locator drift / workflow failure fix | `fix/oic-login-locator` |
| `test/` | Test-only refactor or data update | `test/base-test-cleanup` |
| `chore/` | Infra, agents, instructions, deps | `chore/upgrade-playwright` |
| `docs/` | Markdown only | `docs/oic-automation-notes` |

Rules:
- Lowercase, hyphenated
- Include a short domain cue if helpful: `fix/oic-login-flow`
- Max 60 chars
- Never push to `main` — protected branch

## Commit messages (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Field | Rule |
|---|---|
| `type` | `feat` \| `fix` \| `test` \| `chore` \| `docs` \| `refactor` |
| `scope` | Page area or feature: `login`, `transactions`, `base` |
| `subject` | Imperative, ≤ 72 chars, no period |
| `body` | What + why, wrap 100 chars, blank line after subject |
| `footer` | `Refs: <issue>` or `Fixes: <issue>` |

Examples:
```
feat(login): add Oracle OIC login flow support

Adds shared login setup and page-object support for the Oracle OIC
browser flow using Playwright and TestNG.

Refs: OIC-123
```
```
fix(transactions): stabilize transaction search locator

Updated the Playwright locator to follow the current Oracle OIC page structure
without relying on brittle selectors.
```

## PR rules

1. Title = first line of commit (Conventional format)
2. Description must include:
   - **What changed** (bulleted)
   - **Why** (link issue or ticket)
   - **Test evidence**: build/test summary from Maven runs
3. Reviewer checklist:
   - ✅ Build clean
   - ✅ Strict review APPROVED
   - ✅ Relevant tests pass
   - ✅ New locators or workflows are explained clearly
4. Squash-merge by default — keep `main` linear

## Forbidden

| Pattern | Why |
|---|---|
| Push to `main` directly | Protected; requires PR |
| `git push --force` on shared branches | Rewrites history others rely on |
| Commit messages like `wip`, `fix`, `update` | Useless in `git log` |
| Bypass PR review on changes to automation logic | This code is production behavior |
| Commit `bin/`, `obj/`, `target/`, `TestResults/`, `*.user` | Should be in `.gitignore` |

## When in doubt

Review the diff carefully and verify the relevant Maven build/test output before pushing.
