---
description: End-to-end pre-push checklist — runs the strict code-reviewer, builds, runs touched tests, generates a Conventional-Commits message, and shows the exact git commands to push. Use this before every commit/PR to ship confidently.
argument-hint: Optional scope hint — feature area or ticket ID (e.g., "iOS web clips" or "TC#4716401")
agent: code-reviewer
---

# Prepare PR: ${input:scope}

> Single-shot conductor that walks you through review → build → test → commit → push, applying the rules already defined elsewhere.

## Cross-references (rules live here)

- **Review rules**: [`code-reviewer.agent.md`](../agents/code-reviewer.agent.md)
- **Branch & commit rules**: [`git-workflow.instructions.md`](../instructions/git-workflow.instructions.md)
- **Test execution**: [`test-runner.agent.md`](../agents/test-runner.agent.md)
- **Failure handling**: [`fix-failure.prompt.md`](./fix-failure.prompt.md)

## Run it

Execute these phases in order. Stop and report at the first ❌.

### Phase 1 — Inspect changes
```powershell
git status
git diff --stat HEAD
```
Identify modified files. Continue only if there are staged or unstaged changes.

### Phase 2 — Strict code review
Invoke the reviewer on the diff:
```
@code-reviewer review the current diff vs HEAD
```
Stop if verdict is `❌ BLOCKED`. Report the violations and exit.

### Phase 3 — Build
```powershell
mvn -q -DskipTests compile
```
Stop on any error.

### Phase 4 — Run impacted tests
Determine impacted tests from changed files and then run the relevant Maven test command.
```
mvn -Dtest=<TestClassName> test
```
Stop if the run reports any `❌ FAILURES`. Recommend `/fix-failure <test>` and exit.

### Phase 5 — Branch check
Per `git-workflow.instructions.md`:
- Branch must follow `feat/<scope>` | `fix/<scope>` | `test/<scope>` | `chore/<scope>`
- Never push to `main` directly
- If currently on `main` → suggest creating a feature branch and STOP

### Phase 6 — Generate commit message (Conventional Commits)
Build the message from the changed files + scope hint above:

```
<type>(<scope>): <subject under 72 chars>

<body — what changed and why, wrapped at 100 chars>

Tests:
- <list test files added/modified>

Refs: <ticket/TC if known from scope hint>
```

Type rules:
- `feat:` new test or new POM
- `fix:` locator drift / failure fix
- `test:` test-only changes (rename, refactor, data)
- `chore:` infra / instructions / agents
- `docs:` markdown only

### Phase 7 — Show push commands (do NOT run them)
Print, do not execute:

```powershell
git add <files>
git commit -m "<generated message>"
git push -u origin <branch>
```

Then:
```
gh pr create --fill --base main --head <branch>
```

## Output shape (always)

```
🚦 PRE-PR CHECKLIST  •  scope: ${input:scope}

✅ Phase 1  Diff:        <n> files changed
✅ Phase 2  Review:      APPROVED
✅ Phase 3  Build:       clean
✅ Phase 4  Tests:       <pass>/<total> passed
✅ Phase 5  Branch:      <branch>  ✓ valid

📝 SUGGESTED COMMIT MESSAGE
───────────────────────────
<message>
───────────────────────────

▶️  COPY-PASTE TO PUSH
git add <files>
git commit -m "<subject>"
git push -u origin <branch>
gh pr create --fill --base main --head <branch>
```

If any phase fails, output `❌ BLOCKED at Phase <n>` and **do not** print the push commands.

## Argument

- `scope`: short label for the change (e.g., `iOS web clips`, `TC#4716401`, `flaky logout test`).
  Used in the title and commit message. Required.
