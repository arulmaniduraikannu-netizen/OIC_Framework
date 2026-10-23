---
description: Playwright locator priority ladder for Java and TypeScript projects. Enforces playwright.dev best practices. Auto-loaded for Playwright source files.
applyTo: "src/**/*.java"
---

# Playwright locator rules (cross-project)

Always-on guidance whenever a Playwright file is edited in this workspace.

## Priority ladder (from playwright.dev/docs/locators)

Use the **highest-priority** locator that uniquely identifies the element:

1. `page.getByRole(...)` — interactive elements. **Default.**
2. `page.getByLabel(...)` — form fields with `<label>`.
3. `page.getByPlaceholder(...)`
4. `page.getByText(...)`
5. `page.getByAltText(...)`
6. `page.getByTitle(...)`
7. `page.getByTestId(...)` — requires `data-testid`.
8. `page.locator("css=...")` / XPath — **last resort**, must include a justifying comment.

## Hard rules

- **No `Thread.sleep`, `page.waitForTimeout`, or other hard waits.** Playwright auto-waits — see https://playwright.dev/docs/auto-waiting.
- **Forbidden as sole locator**: brittle vendor IDs like `#idSIButton9` or `[name=loginfmt]`. If used as fallback, chain them behind a semantic locator.
- **Assertions**: prefer visibility and state checks tied to UI state rather than polling.
- **Strict mode**: locators must resolve to one element. Use `.filter()` only when the live evidence identifies the owning container or distinguishing property.
- **No unverified positional selection**: do not use `.first()` or `.nth(i)` for a new or changed locator unless Phase 3 live evidence proves multiple matches and records why that specific match is correct. Visual position such as "second column" is evidence only, never locator identity.
- **Named role contract**: before implementation, record the role, accessible name, exact-match setting, owning container, observed match count, expected action sequence, and any verified fallback locator.
- **Post-implementation verification**: run the focused automated test after adding or changing a locator. Manual inspection or a successful manual click is not sufficient.

## Doc references

- https://playwright.dev/docs/locators
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/auto-waiting
