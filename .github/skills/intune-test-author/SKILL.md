---
name: intune-test-author
description: Domain knowledge package for authoring Java/TestNG/Playwright automation for Oracle OIC workflows. Includes repository conventions, base-class guidance, and Playwright reliability rules.
---

# Legacy Intune/OIC Test Author skill

Historical domain knowledge for Intune-oriented Playwright automation. The active
Oracle OIC Java/TestNG rules live in `AGENTS.md` and `.github/instructions/`; this
skill must not override them. Its C# templates and dotnet validator are legacy
artifacts and are not valid implementation templates for this repository.

## When to invoke this skill

Trigger phrases:
- "Oracle OIC workflow", "Oracle Fusion test"
- "add a Playwright test", "create a page object for Oracle OIC"
- "Run VSA Jobset", "Manage Transactions", "Incentive Compensation"
- "automate Oracle Fusion <feature>"

## Required tools

- `playwright/browser_navigate` + `browser_snapshot` — live UI verification
- file editing — only after the user explicitly approves the proposed change
- `runCommands` — Maven compile + targeted test run

## Standard project layout

```
src/
├── main/java/com/oracle/oic/
│   ├── base/          BasePage.java, PlaywrightFactory.java
│   ├── pages/         LoginPage.java, HomePage.java, <Feature>Page.java
│   └── utils/         ConfigReader.java, ExcelReader.java
└── test/java/com/oracle/oic/
    ├── base/          BaseTest.java
    └── tests/         <Feature>Test.java
```

## Procedure

The active OIC workflow lives in
[intune-test-rules.instructions.md](../../instructions/intune-test-rules.instructions.md).
This skill does not redefine that workflow and should not be used as the authority
for locator, approval, or validation rules.

Quick recap (authoritative version is in the instructions file):
1. Read `.github/intune-knowledge.md` for cached verified entries
2. Phase 1 — Repository context + Oracle domain knowledge
3. Phase 2 — Playwright MCP snapshot + cite timestamp
4. Phase 3 — Implement smallest page-object or test change using existing base classes
5. Run `mvn -q -DskipTests compile` then the narrowest Maven test filter
6. Propose verified findings for `.github/intune-knowledge.md`; do not append or edit without user approval

## Reusable base-class conventions

- All page objects extend `BasePage` — use `getByRole`, `getByLabel`, `click`, `fill`, `waitForVisible`
- All tests extend `BaseTest` — Playwright lifecycle handled; access page via `getPage()`
- Config values come from `ConfigReader` — never hard-code URLs, credentials, or timeouts
- `PlaywrightFactory` manages browser and context; do not instantiate it directly in tests

## Common Oracle Fusion workflows (cached references)

| Feature | Entry path |
|---|---|
| Manage Transactions | Navigator → Incentive Compensation → Credits and Earnings → Tasks → Manage Transactions |
| Manage Jobsets | Navigator → Incentive Compensation → Processes → Manage Jobsets |
| Run Processes | Navigator → Incentive Compensation → Processes → Run Processes |

> Always verify the current menu path with a Playwright MCP snapshot before writing code.

## Anti-patterns to refuse

- Generating locators without a Playwright MCP snapshot
- Hardcoding XPath or CSS as the primary locator
- Skipping `BasePage` helpers to write inline page interactions in tests
- Using `Thread.sleep`, `page.waitForTimeout`, or any hard wait
- Hard-coding `baseUrl`, credentials, or timeouts inside test or page-object files
