# Test failure log

> **Append-only**. One row per real test failure investigated by the
> [`locator-healer`](agents/locator-healer.agent.md) agent or the
> [`/fix-failure`](prompts/fix-failure.prompt.md) prompt.
>
> **Do not delete or edit prior rows.** If the same test fails again with a
> different cause, add a new row.
>
> Maintained by humans + Copilot. Shared via Git.

## Row format

| # | Date (UTC) | Test | Category | Page / URL | Old locator | New locator | Root cause (≤ 15 words) | Verified by | PR / Commit |
|---|---|---|---|---|---|---|---|---|---|

Categories:

- `LOCATOR_DRIFT` — UI refactor moved/renamed the element
- `LOCATOR_AMBIGUOUS` — selector matched multiple elements
- `TIMING` — element appeared later than expected (fix = web-first assertion, never sleep)
- `NAVIGATION` — page never reached the expected URL
- `REAL_BUG` — feature genuinely broken; locator was correct
- `ENV` — auth/tenant/network failure unrelated to the test

`Verified by` is one of:

- `MCP <YYYY-MM-DD>` — re-snapshotted via Playwright MCP on that date
- `manual` — verified by hand in the browser
- `n/a` — REAL_BUG / ENV; no locator change made

---

## Log

| # | Date (UTC) | Test | Category | Page / URL | Old locator | New locator | Root cause | Verified by | PR / Commit |
|---|---|---|---|---|---|---|---|---|---|
| _example_ | 2026-01-01 | `AddIosWebClipTest` | LOCATOR_DRIFT | `/#view/Microsoft_Intune_Apps/.../iosWebClip` | `Locator(".btn-add-app")` | `GetByRole(AriaRole.Button, new() { Name = "Add" })` | Class `btn-add-app` removed in portal redesign | MCP 2026-01-01 | _none_ |

<!-- Add new rows below this line. Do not modify rows above. -->
| 1 | 2026-07-06 | `Create_WindowsCompliancePolicy_DeploysToTargetGroup_TC2791177` | ENV | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize...` | `GroupsList.ReactView` searchbox `Search` | n/a | Missing `INTUNE_STORAGE_STATE` redirected portal to login | n/a | _none_ |
| 2 | 2026-07-10 | `TC4179763_CreateWin32AppWithUnsignedScriptsAllowed` | ENV | `https://intune.microsoft.com` | `GetByRole(AriaRole.Link, new() { Name = "Apps" })` | n/a | No authenticated session; portal redirects to login; Apps nav never loads | MCP 2026-07-10 | _none_ |
| 3 | 2026-07-13 | `TC4179763_CreateWin32AppWithUnsignedScriptsAllowed` | ENV | `https://login.microsoftonline.com` | `GetByRole(AriaRole.Link, new() { Name = "Apps" })` | n/a | Test base class missing auth state setup; portal requires login | MCP 2026-07-13 | _none_ |
| 4 | 2026-07-14 | `Create_MicrosoftStoreAppRequiredToAllUsers_TC14673239` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/AppsMenu/~/allApps` | `Page.GetByRole(AriaRole.Button, new() { Name = "Create", Exact = true })` | `Page.FrameLocator("iframe[name=\"AppList.ReactView\"]").GetByRole(AriaRole.Menuitem, new() { Name = "Create", Exact = true })` | All Apps command-bar "Create" is a menuitem inside AppList.ReactView iframe, not a top-level button | MCP 2026-07-14 | _none_ |
| 5 | 2026-07-14 | `Create_MicrosoftStoreAppRequiredToAllUsers_TC14673239` | ENV | `https://login.microsoftonline.com/...` | `GetByRole(AriaRole.Button, new() { Name = "Search the Microsoft Store app (new)", Exact = true })` | n/a | No authenticated session; portal redirected to login before reaching Add App wizard | MCP 2026-07-14 | _none_ |
| 6 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | ENV | `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize...` | `GetByRole(AriaRole.Link, new() { Name = "Endpoint security" })` | n/a | Missing INTUNE_STORAGE_STATE; dotnet output shows redirect to login.microsoftonline.com | n/a | _none_ |
| 7 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | TIMING | `https://intune.microsoft.com` | `ToBeVisibleAsync(new() { Timeout = 30000 })` | `ToBeVisibleAsync(new() { Timeout = 60000 })` | OAuth redirect consumed timeout; sidebar rendered after 30s elapsed | MCP 2026-07-15 | _none_ |
| 8 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com` | `iframe[name="MIPolicyWizard.ReactView"]` + XPath `following::input[1]` | `iframe[name="TemplateWizard.ReactView"]` + `GetByRole(Textbox, "Name/Description")` | Wrong iframe name; portal uses `TemplateWizard.ReactView` not `MIPolicyWizard.ReactView` | intune-knowledge.md 2026-07-14 | _none_ |
| 9 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com` | `Page.GetByRole(AriaRole.Menuitem, new() { Name = "Include" })` | `WizardFrame.GetByRole(AriaRole.Menuitem, new() { Name = "Include" })` | Assignments menuitem is inside the wizard iframe | MCP 2026-07-11 | _none_ |
| 10 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com` | Assert SettingsTab after second Next click | Assert SettingsTab before second Next click | Code order bug: verified Settings after navigating away to Assignments | code-review | _none_ |
| 11 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/...AppControlForBusiness` | `iframe[name="MIPolicyWizard.ReactView"]` | `iframe[name="TemplateWizard.ReactView"]` | Wrong iframe name; intune-knowledge.md confirms correct iframe is TemplateWizard.ReactView | intune-knowledge.md 2026-07-14 | _none_ |
| 12 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | TIMING | `https://intune.microsoft.com/#view/.../AppControlForBusiness` | `ToHaveAttributeAsync("aria-selected", "true")` on SettingsTab/AssignmentsTab | `ToBeVisibleAsync()` + `ClickAsync()` on tabs | Wizard transition timing varies; `aria-selected` attribute set async after Next click | dotnet output 2026-07-15 | _none_ |
| 13 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com` MIPolicyWizard Settings tab | `Expect(ManagedInstallerSwitch).ToBeCheckedAsync()` | `Expect(...).ToBeVisibleAsync()` + `ClickAsync()` | Switch defaults to OFF; test wrongly asserted it was already ON instead of clicking to enable | intune-knowledge.md step 5 | _none_ |
| 14 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com` wizard Settings tab | `WizardFrame.GetByRole(AriaRole.Switch).First` | `Page.GetByRole(AriaRole.Switch, new() { Name = "Trust apps..." })` | Wizard controls render at TOP LEVEL, not in iframe; also added semantic name filter | intune-knowledge.md TC#1377425 pattern | _none_ |
| 15 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/MIPolicyWizard.ReactView` | `Page.GetByRole(AriaRole.Textbox, new() { Name = "Name" })` | `WizardFrame.GetByLabel("Name")` | Wizard controls (Name textbox, tabs, buttons) render inside MIPolicyWizard.ReactView iframe, not at top level; textbox has no accessible name, use GetByLabel | MCP 2026-07-15 | _none_ |
| 16 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/MIPolicyWizard.ReactView` | `WizardFrame.GetByLabel("Name")` / `GetByLabel("Description")` | `WizardFrame.GetByRole(AriaRole.Textbox).First` / `.Nth(1)` | GetByLabel resolves to LABEL element not INPUT; labels lack for/id association; use GetByRole(Textbox) positionally | MCP 2026-07-15 | _none_ |
| 17 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/MIPolicyWizard.ReactView` Settings tab | `GetByRole(AriaRole.Switch, new() { Name = "Trust apps from managed installer" })` | `GetByRole(AriaRole.Switch, new() { Name = "Enabled" })` | Switch aria-name is "Enabled"; setting description in separate label element | MCP 2026-07-15 | _none_ |
| 18 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | TIMING | `https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/MIPolicyWizard.ReactView` wizard | `SettingsTab.ClickAsync()` after `NextButton.ClickAsync()` | Removed redundant tab click | Redundant click on already-selected Settings tab triggered re-render hiding switch momentarily | MCP 2026-07-15 | _none_ |
| 19 | 2026-07-15 | `Validate_ManagedInstallerPolicyProperties_TC33120786` | LOCATOR_DRIFT | `https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/MIPolicyWizard.ReactView` Settings tab | `GetByRole(AriaRole.Switch, new() { Name = "Enabled" })` | `GetByRole(AriaRole.Switch).First` | Switch aria-name is state-dependent: "Enabled" when ON, "Disabled" when OFF; use state-agnostic locator | MCP 2026-07-15 | _none_ |
| 20 | 2026-08-24 | `CollectionTransactionsTest.collectionProcessCanBeSubmitted` | LOCATOR_DRIFT | `https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome` | `click(Expand Incentive Compensation)` | `clickForce(Expand Incentive Compensation)` | Verified link was covered by the clickable navigation-group div | MCP 2026-08-24 | _none_ |
| 21 | 2026-08-27 | `PurgeStagingTableTest.purgeTransactionStagingTableCanBeConfigured` | LOCATOR_AMBIGUOUS | `https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome` | `click(Job radio)` | `isChecked()` then `clickForce(Job radio)` only when needed | Job is selected by default and its visible label intercepts the radio input | MCP 2026-08-27 | _none_ |
| 22 | 2026-08-27 | `PurgeStagingTableTest.purgeTransactionStagingTableCanBeConfigured` | LOCATOR_AMBIGUOUS | `https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome` | `getByText("Process Details", true)` | `getByText("Process Details", true).first()` | Visible dialog heading shares text with a hidden navigation link | MCP 2026-08-27 | _none_ |
| 23 | 2026-08-27 | `TransactionDetailsExportTest.transactionDetailsArePrintedToExcel` | TIMING | `https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FndOverview?fndGlobalItemNodeId=itemNode_incentive_compensation_credits_and_earnings` | `table[aria-label='Manage Transactions: Search Results']` hover with action-timeout wait | `waitForVisible(table[aria-label='Manage Transactions: Search Results'], navigationTimeout)` before wheel scroll | Search results grid re-renders asynchronously after Search, exceeding the 10s action timeout | MCP 2026-08-27 | _none_ |
| 24 | 2026-09-21 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | TIMING | `https://ecaw-dev3.fa.ocs.oraclecloud.com/analytics/saw.dll?catalog` | Select `/Shared Folders` after only the `Location` combobox was visible | Wait for the `/Shared Folders` option before selection | Catalog options populate after the combobox becomes visible | MCP 2026-09-21 | _none_ |
| 25 | 2026-09-21 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | LOCATOR_DRIFT | `https://ecaw-dev3.fa.ocs.oraclecloud.com/analytics/saw.dll?catalog` | `Location` combobox option `/Shared Folders` | Catalog tree `Shared Folders` then exact `Custom` and `SILVUS` folders | Location select now exposes only `/My Folders`; verified shared path is in catalog tree | MCP 2026-09-21 | _none_ |
| 26 | 2026-09-21 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | LOCATOR_DRIFT | `https://ecaw-dev3.fa.ocs.oraclecloud.com/fscmUI/faces/FuseWelcome` | Exact `Participant Snapshot` link on initial Home tab | Exact `Incentive Compensation` link, then exact `Participant Snapshot` link | Participant Snapshot moved under the Incentive Compensation navigation tab | MCP 2026-09-21 | _none_ |
| 27 | 2026-09-21 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | NAVIGATION | `https://ecaw-dev3.fa.ocs.oraclecloud.com/fscmUI/faces/FuseWelcome` | Open Incentive Compensation immediately after the OTBI report | Exact `Home` link, then Incentive Compensation and Participant Snapshot links | Test remained on Reports and Analytics after opening the OTBI report | MCP 2026-09-21 | _none_ |
| 28 | 2026-09-22 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | LOCATOR_DRIFT | `https://ecaw-dev3.fa.ocs.oraclecloud.com/fscmUI/faces/FuseOverview` | Body-scoped `Event Date` header and hidden sort control | Sibling header table; click Event Date, then visible `Sort Descending` | Event Date header is separate; sort controls appear only after header click | MCP 2026-09-22 | _none_ |
| 29 | 2026-09-22 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | LOCATOR_DRIFT | `https://ecaw-dev3.fa.ocs.oraclecloud.com/fscmUI/faces/FuseOverview` | `getByRole(COLUMNHEADER, "Event Date")` | Exact `Event Date` text scoped to the verified header table, then title-scoped `Sort Descending` | Dev3 renders the header as a visible `<th>` without an ARIA columnheader role; sort links become visible after header activation | MCP 2026-09-22 | pending focused rerun |
| 30 | 2026-09-28 | `SilvusRwDashboardAnalysisTest.compareSilvusEarningsSources` | LOCATOR_DRIFT | `https://ecaw-dev3.fa.ocs.oraclecloud.com/analytics/saw.dll?PortalGo` | `getByText("Results", true)` | `table.ViewTable` visibility check | Live Dev3 report had one visible populated ViewTable and zero exact `Results` text matches; focused rerun passed | MCP 2026-09-28 | fixed and verified |
