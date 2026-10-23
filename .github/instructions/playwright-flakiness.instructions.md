---
description: Playwright anti-flakiness rules for this Java/TestNG repository. Auto-loaded for test files.
applyTo: "src/**/*.java"
---

# Playwright anti-flakiness rules

Always-on guidance for any Playwright test file in this repository. Pair this with [playwright-locators.instructions.md](playwright-locators.instructions.md).

## Forbidden — never use these

| ❌ Do not use | ✅ Use instead |
|---|---|
| `Thread.sleep(...)` | Auto-waiting + web-first assertions |
| `Thread.sleep(...)` in test flows | `locator.waitFor()` or explicit waits tied to UI state |
| `page.waitForTimeout(...)` | Web-first assertions and locator waits |
| Polling loops with try/catch | Web-first assertions auto-retry |

## Web-first assertions (REQUIRED)

Always use these — they auto-retry until the expected state or timeout.

```java
// Java / Playwright
locator.waitFor(new Locator.WaitForOptions().setTimeout(5000));
assertTrue(locator.isVisible());
```

```typescript
// TypeScript / JavaScript
await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
await expect(page.getByText('Success')).toBeVisible();
```

## Timeout strategy

- **Default action timeout**: 5–10s (set in config, not per-call).
- **Navigation timeout**: 30s for SPAs, 60s for slow portals.
- **Explicit timeout**: only when an action genuinely takes longer than default.

## Strict mode (REQUIRED)

A locator must resolve to **exactly one** element. If multiple elements match, scope it
to the live-verified owning container or add a live-verified semantic property. Do not
these positional methods are prohibited as an unverified ambiguity fix; the locator policy permits
positional selection only when live evidence documents the match count and selected
element.

## Test isolation (REQUIRED)

- Each test creates its own data; never depend on state from a previous test.
- Use setup and teardown hooks for cleanup.
- Always clean up created entities in teardown — even when the test fails.

## References (verify when uncertain)

- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/auto-waiting
- https://playwright.dev/docs/test-assertions
