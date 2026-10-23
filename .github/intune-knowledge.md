# Legacy Intune verification cache (not active OIC guidance)

Historical Intune workflows and locators verified via Microsoft Learn.

This repository's active project is Oracle OIC Java/TestNG automation. This file is
retained as historical reference only and must not override `AGENTS.md`, the scoped
Playwright instructions, or current Phase 2 evidence. Its C#/Intune examples are not
templates for OIC code, and positional selectors in historical entries are not
approved locator patterns for new or changed Java code.
MCP + Playwright MCP. **Committed to Git — shared with the whole team.**

> Local fast-access mirror lives at `/memories/repo/intune-knowledge.md`.
> The shared file (this one) wins on conflict — refresh memory from this file
> when starting a new session.

## Conventions

- One section per test case or workflow
- `Verified` date in `YYYY-MM-DD`
- Refresh entries older than 90 days before reuse
- Locators must include the snapshot timestamp
- When you verify something new, **append to this file and commit it** so
  teammates inherit the verified knowledge

## Verified URLs

- Admin portal: https://intune.microsoft.com — verified 2026-06-07

## Workflows

> Add entries here after each successful 3-phase generation.

### Template

```
## TC#<id> — <title>
- Source (Learn MCP): <learn.microsoft.com URL>
- Verified: <YYYY-MM-DD>
- Verified by: <github-handle>
- Workflow:
  1. <step>
  2. <step>
- Locators (Playwright MCP):
  - getByRole(button, "Add") — verified
  - getByLabel("Name") — verified
- Notes: <gotchas, slow loads, modal quirks>
```

### TC#1377425 — Create an Update rings policy and deploy to the target group

- Source (Learn MCP):
  - https://learn.microsoft.com/intune/device-updates/windows/manage-update-rings#create-and-assign-update-rings
  - https://learn.microsoft.com/intune/device-updates/windows/ref-update-ring-settings
  - https://learn.microsoft.com/intune/fundamentals/tenant-administration/add-groups#add-groups-to-intune
- Verified: 2026-06-08 (Phase 1 Learn MCP + Phase 2 Playwright MCP snapshot, tenant TEST_TEST_M365E5_SelfServiceHb_202604171019_Wmil_aXpT3)
- Deep link: `https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/windows10Update`
- Workflow (Update rings):
  1. Navigate to Devices > Windows updates (deep link above)
  2. Click tab `Update rings`
  3. Click toolbar menuitem `Create profile` (renders inside iframe `Windows10Updates.ReactView`)
  4. Wizard "Create Update ring for Windows 10 and later":
     - Basics tab: textbox `Name`, textbox `Description` > button `Next`
     - Update ring settings tab: textbox `Feature update deferral period (days)`, textbox `Quality update deferral period (days)` > button `Next`
     - Assignments tab: inside group `Included groups`, button `Add groups` > picker > searchbox `Search` > row `Select row <name>` > checkbox `Select row` > button `Select` > button `Next`
     - Review + create tab: button `Create`
  5. Assert: row with profile name appears in iframe `Windows10Updates.ReactView` grid
- Workflow (Group precondition):
  - **AddGroupBlade is broken** in this tenant ("The extension encountered an unexpected error" on every load — Microsoft is migrating group management to entra.microsoft.com).
  - Treat group creation as a precondition; provision via Graph API / Azure CLI / entra.microsoft.com.
  - Verified existing group `AI_Automation_Device_group` in the test tenant (used as default in test data).
- Locators (Playwright MCP) — all verified 2026-06-08T12:43Z:
  - `iframe[name="Windows10Updates.ReactView"]` → `tab "Update rings"`, `menuitem "Create profile"`, grid rows by exact name
  - Top-level: `tab "Basics" | "Update ring settings" | "Assignments" | "Review + create"`
  - Top-level: `textbox "Name"`, `textbox "Description"`, `textbox "Feature update deferral period (days)"`, `textbox "Quality update deferral period (days)"`, `button "Next"`, `button "Previous"`, `button "Create"`
  - Top-level: `group "Included groups"` > `button "Add groups"`
  - `iframe[name="ObjectPicker.ReactView"]` (group picker) → `searchbox "Search"`, `row "Select row <name>"`, `checkbox "Select row"`, `button "Select"`
  - `iframe[name="GroupsList.ReactView"]` (All groups list) → `searchbox "Search"`, grid columns `Name | Object Id | Group type | Membership type | Email`
- Notes:
  - Steps 1 (device enrollment), 6 (manual sync), 7 (registry check) are **not portal-automatable** — out of scope for Playwright.
  - Profile creation can take up to 60s — keep `Timeout = 60000` on the success row assertion.
  - Wizard tabs / buttons / inputs render in the **top-level page**, NOT in an iframe.
  - Only the **list grids** (Update rings list, All groups list, group picker) render inside iframes.

### TC#33120786 — [Managed Installer with Targeting] Validate Managed Installer Policy Properties

- Source (Learn MCP): https://learn.microsoft.com/en-us/intune/device-configuration/endpoint-security/manage-app-control
- Verified: 2026-07-14
- Verified by: github-copilot
- Workflow:
  1. Navigate to `Endpoint security` > `App Control for Business`
  2. In iframe `AppControlForBusiness.ReactView`, select tab `Managed installer`
  3. Click menuitem `Create`
  4. Basics: fill textbox `Name` = `Managed Installer Policy` and textbox `Description` = `Adds Managed Installer Node to AppLocker Policy for Testing`
  5. Configuration settings: choose `Built-in controls`, then enable switch `Trust apps from managed installer`
  6. Scope tags: keep `Default`
  7. Assignments: fill combobox `Groups` with `AI_Automation_Device_group` and select the matching option
  8. Review + create: button `Create`
  9. Open the new policy row (`Managed Installer Policy`) and verify the summary blade properties
  10. Open `Edit Configuration settings` and verify `Trust apps from managed installer` is checked/on
- Locators (Playwright MCP) — verified 2026-07-14T12:46Z and 2026-07-14T12:52Z:
  - `iframe[name="AppControlForBusiness.ReactView"]` → `tab "Managed installer"`, `menuitem "Create"`, policy row link `<policyName>`
  - `iframe[name="MIPolicyWizard.ReactView"]` → `textbox "Name"`, `textbox "Description"`, `button "Next"`, `menuitem "Include"`, `combobox "Policy creation type"`, `option "Built-in controls"`, `switch "Trust apps from managed installer"`, `combobox "Groups"`, `button "Create"` — CORRECTED 2026-07-15 from a live verified run (URL route `MIPolicyWizard.ReactView`). The earlier `TemplateWizard.ReactView` entry was WRONG (that frame never renders); do not revert.
  - `combobox "Groups"` suggestions in the wizard frame include option text `AI_Automation_Device_group`
  - Summary blade → `link "Edit Configuration settings"`, `button "Delete"`, `text "Managed Installer Policy"`, `text "Adds Managed Installer Node to AppLocker Policy for Testing"`, `text "AI_Automation_Device_group"`

### TC#9495552 — [IntuneSA]:[Windows][Win10]:[Assignment Filters][Conflict]:[WinClassicApp]

- Source (Learn MCP):
  - https://learn.microsoft.com/en-us/intune/app-management/deployment/add-win32
  - https://learn.microsoft.com/en-us/intune/fundamentals/filters/overview
- Verified: 2026-07-14 (Phase 1 Learn MCP + Phase 2 Playwright MCP snapshots)
- Verified by: github-copilot
- Workflow:
  1. Navigate to Apps > Windows apps > Create and choose Windows app (Win32)
  2. Upload `19 Fake MSI.intunewin`
  3. Update App information Name and Publisher to `Test8A`
  4. Set Requirements minimum OS to `Windows 10 1607`
  5. Configure Detection rules as manual MSI
  6. Add Required assignment for `Phase2 UserGroup` with filter `AFMatch` using Include
  7. Add Available assignment for `Phase2A UserGroup` with filter `AFMatch` using Include
- Locators (Playwright MCP) — verified 2026-07-14T02:31Z, 02:32Z, 02:33Z, 02:34Z, 02:36Z, 02:37Z, 02:38Z:
  - `iframe[name="AppList.ReactView"]` -> `menuitem "Create"`
  - `iframe[name="SelectAppType.ReactView"]` -> `combobox "App type Select app type"`, `option "Windows app (Win32)"`, `button "Select"`
  - Top-level wizard -> `button "Select app package file"`, `textbox "Select a file"`, `textbox "Name"`, `textbox "Publisher"`, `button "Next"`, `button "Create"`
  - Requirements -> `button "Minimum operating system"`, `combobox "Minimum operating system"`, treeitem `Windows 10 1607`
  - Detection rules -> `button "Rules format"`, `combobox "Rules format"`, `button "Add"`, `combobox "Rule type"`, treeitem `MSI`, `button "OK"`
  - Assignments -> `button "Add group"` (Nth(0)/Nth(1)), `iframe[name="ObjectPicker.ReactView"]` -> `searchbox "Search"`, `row "Select row <group>"`, `checkbox "Select row"`, `button "Select"`
  - Assignment filters -> `complementary "Assignment filters"`, `radio "Include filtered devices in assignment"`, `button "Select"`, row links `Include` and `AFMatch`
- Notes:
  - Wizard includes Dependencies, Supersedence, and Scope tags between Detection rules and Assignments.
  - File upload required copying the `.intunewin` into a workspace-accessible path before `SetFilesAsync` in MCP.

### TC#14673239 — [IntuneSA]:[Windows]:[WinGetStoreApp]:[Required][UserGroup][UWPType][UserScope]

- Source (Learn MCP query "Intune add Microsoft Store app new winget assignments"):
  - https://learn.microsoft.com/en-us/intune/intune-service/apps/store-apps-microsoft
- Source workbook: 1784039122199-idc-vendor-regression-test-2604-winget-app-test-cases-k-1.xlsx (sheet Test Cases, row 2)
- Verified: 2026-07-14 (Phase 1 Learn MCP + Phase 2 live Playwright MCP end-to-end run,
  tenant TEST_TEST_M365E5_SelfServiceHb_202604171019_Wmil_aXpT3). App "Test1" was actually
  created and deleted live; focused `dotnet test` PASSED (40s) with an exported storage state.
- Verified by: github-copilot
- Workflow (exactly the 5 Excel steps):
  1. Apps > All Apps > Create
  2. Select app type: Platform = Windows, App type = Microsoft Store app (new) > Select
  3. Search the Microsoft Store app (new) -> `WhatsApp` (result row Type = UWP) -> Select
  4. App information: overwrite Name (default "WhatsApp") with `Test1`; Installer Type shows
     `UWP` and Install behavior shows `User` (matches UWPType/UserScope) > Next > Next (Scope tags)
  5. Assignments: under **Required**, click `Add all users` > Next > Review + create > Create
- **iframe vs top-level map (verified 2026-07-14T14:35-14:40Z)** — this corrects the earlier
  2026-07-11 trace that modeled everything as top-level:
  - Apps list toolbar: `iframe[name="AppList.ReactView"]` -> `menuitem "Create"`
  - Select app type flyout: `iframe[name="SelectAppType.ReactView"]` -> `combobox "Platform Select Platform"`,
    `option "Windows"`, `combobox "App type Select app type"`, `option "Microsoft Store app (new)"`, `button "Select"`
  - Add App wizard / search flyout / assignments / review / overview: **TOP LEVEL** (no iframe)
- Locators (Playwright MCP) — verified 2026-07-14:
  - Top-level: `link "Apps"`, `link "All Apps"`
  - Search flyout (top-level): `button "Search the Microsoft Store app (new)"` (exact),
    `searchbox "Search the Microsoft Store app (new)"`, `gridcell "WhatsApp"` (exact),
    `complementary "Search the Microsoft Store app (new)" >> button "Select"`
  - App info (top-level): `textbox "Name"`, `button "Next"` (exact)
  - Assignments (top-level): `button "Add all users"` (exact) — 3 instances (Required/Available/Uninstall),
    Required is `.First`; verify via `grid "Required Assignments" >> gridcell "All users"`
  - Review + create (top-level): `button "Create"` (exact)
  - Overview + delete (top-level): `heading "Test1"`, `button "Delete"`, dialog `button "Yes"`
- Notes:
  - Success signal after Create = redirect to app overview at
    `#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/<guid>` with `heading "Test1"`.
  - Delete from the overview page uses a top-level `button "Delete"` + `"Are you sure?"` dialog
    (different from the list-row right-click Delete menuitem).
  - Storage state can be exported from a signed-in Playwright MCP browser via
    `context.storageState()`; write to `IntuneTests/auth/intune.state.json` (gitignored) and set
    `INTUNE_STORAGE_STATE` to run the NUnit test headlessly.

## Known gotchas

### TC#3639071 — [Test Cases   1] PowerShell Script Scope Tag Testing - NO SCOPE TAGS

- Source (Learn MCP):
  - https://learn.microsoft.com/en-us/intune/device-management/tools/run-powershell-scripts-windows
- Source workbook:
  - IDC Vendor Regression Test 2605_Scope Tags Cases.xlsx (sheet Test Cases, row 2)
- Verified: 2026-07-02 (Phase 1 Learn MCP + Phase 2 Playwright MCP snapshots)
- Verified by: github-copilot
- Workflow:
  1. Navigate to `https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/scripts`
  2. In iframe `ConfigurationScripts.ReactView`, open tab `Platform scripts`
  3. Click menuitem `Add` > menuitem `Windows 10 and later`
  4. In wizard `Add PowerShell script`, complete `Basics` and `Script settings` (script upload required)
  5. On `Scope tags`, verify default row `Default`
  6. Click `Select scope tags` and verify pane `Select tags` with searchable tags list
- Locators (Playwright MCP) — verified snapshots @ 2026-07-02T12:12:11Z, 12:13:36Z, 12:13:46Z, 12:14:32Z, 12:16:49Z, 12:17:05Z:
  - `iframe[name="ConfigurationScripts.ReactView"]` → `tab "Platform scripts"`, `menuitem "Add"`, `menuitem "Windows 10 and later"`
  - Top-level wizard: `heading "Add PowerShell script"`, `textbox "Name"`, `textbox "Description"`, `button "Next"`
  - Script settings: `button "Script location Select a file"`
  - Scope tags: `tab "Scope tags"`, `grid "Scope tags"`, row containing `Default`, `button "Select scope tags"`
  - Select tags pane: `heading "Select tags"`, `searchbox "Search by name"`, rows including `AutoScopeTag` and `Default`

- Intune app creation can take up to 60s — use `Timeout = 60000` on the success toast.
- Right-click context menus may require a hover step first on some grids.
- Some panes lazy-load; snapshot after the network is idle.
- Playwright MCP needs Chrome installed system-wide. `npx playwright install chrome` requires an elevated shell on Windows. Configure `.vscode/mcp.json` with `--browser=chrome` so the MCP picks up the system install.
- **Legacy `Microsoft_AAD_IAM/AddGroupBlade` is broken** in many test tenants — "The extension encountered an unexpected error". Provision groups via Graph API / `entra.microsoft.com` instead.
- Intune wizard pages mix top-level controls with iframe-hosted grids: wizards/forms render at top level; lists/pickers render inside iframes (`Windows10Updates.ReactView`, `ObjectPicker.ReactView`, `GroupsList.ReactView`).

### TC#33120786 — [Managed Installer with Targeting] Validate Managed Installer Policy Properties

- Source (Learn MCP):
  - https://learn.microsoft.com/en-us/intune/device-configuration/endpoint-security/manage-app-control
- Verified: 2026-07-15 (Playwright MCP full live scenario run)
- Verified by: Copilot
- Workflow:
  1. Navigate to `Endpoint security` > `App Control for Business` > `Managed installer`
  2. Select `Create` menuitem
  3. Fill `Name` = `Managed Installer Policy` and `Description` = `Adds Managed Installer Node to AppLocker Policy for Testing`
  4. Click `Next` twice and leave Settings enabled (switch checked by default)
  5. Click `Include` menuitem, force-click the group checkbox for `AI_Automation_Device_group`, then click `Select`
  6. Click `Next` to Review tab, then `Save`
  7. Select the newly created policy from the list, click `Properties`, verify name/description/settings=Yes
- Locators (Playwright MCP):
  - `getByRole(link, "Endpoint security")`
  - `getByRole(link, "App Control for Business")`
  - `iframe[name="AppControlForBusiness.ReactView"]` -> `getByRole(tab, "Managed installer")`
  - `iframe[name="AppControlForBusiness.ReactView"]` -> `getByRole(menuitem, "Create")`
  - `iframe[name="MIPolicyWizard.ReactView"]` -> `getByRole(textbox).First` (Name)
  - `iframe[name="MIPolicyWizard.ReactView"]` -> `getByRole(textbox).Nth(1)` (Description)
  - `iframe[name="MIPolicyWizard.ReactView"]` -> `getByRole(tab, "Assignments")`
  - `iframe[name="MIPolicyWizard.ReactView"]` -> `getByRole(menuitem, "Include")` (inside menubar "Command bar")
  - `iframe[name="assignments.ReactView"]` -> `getByRole(row, "AI_Automation_Device_group").getByRole(checkbox).click({ force: true })` **CRITICAL: checkbox overlay requires force click**
  - `iframe[name="assignments.ReactView"]` -> `getByRole(button, "Select")`
  - `iframe[name="MIPolicyWizard.ReactView"]` -> `getByRole(button, "Save")`
  - `getByRole(link, "Properties")`
  - `getByText("Yes", exact)` for Settings verification
- Notes:
  - The group picker checkbox has an overlay element that intercepts pointer events — must use `force: true`
  - Multiple policies with same name can exist — use `.First` to get most recently created
  - Assignments may show "No results" initially on Properties page due to sync delay

## TC-OIC-001 — Oracle Fusion OIC login (ecaw-test tenant)
- Source (Oracle docs): https://docs.oracle.com/en/cloud/saas/applications-common/26c/oacpr/sign-in-and-get-started.html ; baseline https://docs.oracle.com/en/cloud/saas/applications-common/
- Verified: 2026-08-15 (live Playwright inspection, snapshot 2026-08-15T19:29Z)
- Verified by: oic chain (oic-domain-research -> oic-ui-inspector -> oic-code-generator)
- Workflow:
  1. Navigate to `https://ecaw-test.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome` (external config `baseUrl`)
  2. Tenant redirects: FuseWelcome -> IDCS OAuth authorize -> combined IDCS sign-in at `/ui/v1/signin`
  3. Fill `textbox "Username"`, fill `textbox "Password"`
  4. Click `button "Next"` (submit; there is no separate "Sign In" button)
  5. Redirects back to `FuseWelcome`; wait for global header `link "Navigator"` to confirm home rendered
- Locators (Playwright, role-based — validated against live page):
  - `getByRole(textbox, "Username", exact)` — id `idcs-signin-basic-signin-form-username|input`
  - `getByRole(textbox, "Password", exact)` — id `idcs-signin-basic-signin-form-password|input`, type=password
  - `getByRole(button, "Next", exact)` — submit
  - `getByRole(button, "Sign in with OKTA SSO")` — alternative IdP, do NOT match with regex `/Sign In/i`
  - `getByRole(link, "Need help signing in?")`
  - Home: `getByRole(link, "Navigator", exact)` visible post-login
- Notes:
  - DO NOT use the bare element ids (`#idcs-signin-basic-signin-form-username`): they point at a JET wrapper; the real input id has a `|input` suffix. Role locators resolve to the actual input and `fill` works (verified fill lengths).
  - URL wait patterns already correct in LoginPage: `.*/signin.*` (sign-in) and `.*/fscmUI/faces/FuseWelcome.*` (home).
  - Test `com.oracle.oic.tests.LoginTest` passed (Maven surefire, 2026-08-16, 42 s).

## TC-OIC-ROW-8 — Run the SQL query for staging table
- Source (Oracle docs):
  - https://docs.oracle.com/en/cloud/saas/applications-common/
  - https://docs.oracle.com/en/cloud/saas/applications-common/24d/facia/get-started-with-your-application.html
  - https://docs.oracle.com/en/cloud/saas/applications-common/25c/fauap/create-a-data-model.html
  - https://docs.oracle.com/en/cloud/saas/applications-common/25c/fauap/how-you-create-a-sql-query-data-set.html
  - https://docs.oracle.com/en/cloud/saas/sales/oedms/cntptransactionsstagingt-13629.html#cntptransactionsstagingt-13629
- Verified: 2026-09-04
- Verified by: github-copilot
- Workflow:
  1. Navigate to the Fusion home page and confirm `link "Navigator"` is visible.
  2. Open Navigator, expand `Tools`, and select `Reports and Analytics`.
  3. On the Reports and Analytics page, click `button "Browse Catalog"` and switch to the new catalog tab.
  4. In Catalog, click `button "Create drop down menu"` and choose `link "Data Model"`.
  5. In iframe `generalObjectEditor*`, click `link "New Data SetNew Data Set"` and then `link "SQL Query"`.
  6. In the SQL Query dialog, fill `textbox "* Name"` with `StagingTransactionCount`, select `combobox "* Data Source"` value `ApplicationDB_FSCM`, and fill `textbox "* SQL Query"` with the workbook SQL.
  7. Click `button "OK"`, open `link "Data"`, set `combobox "Rows"` to `50`, and click `button "View"`.
  8. Assert the result region shows `Tree View | Table View` and the rendered count text `COUNT___ (0)`.
- Locators (Playwright MCP) — verified 2026-09-04T08:06Z-08:08Z:
  - Home: `getByRole(link, "Navigator", exact)`
  - Navigator panel: `getByRole(link, "Expand Tools")`, `getByRole(link, "Reports and Analytics", exact)`
  - Reports page: `getByRole(button, "Browse Catalog", exact)`
  - Catalog tab: `getByRole(button, "Create drop down menu", exact)`, `getByRole(link, "Data Model", exact)`
  - Data Model iframe `iframe[name^="generalObjectEditor"]`
  - Inside iframe: `getByRole(link, "New Data SetNew Data Set", exact)`, `getByRole(link, "SQL Query", exact)`, `getByLabel("* Name", exact)`, `getByLabel("* Data Source", exact)`, `getByLabel("* SQL Query", exact)`, `getByRole(button, "OK", exact)`, `getByRole(link, "Data", exact)`, `getByLabel("Rows", exact)`, `getByRole(button, "View", exact)`
  - Result text: `getByText("COUNT___ (", non-exact)` with observed value `COUNT___ (0)`
- Notes:
  - `Browse Catalog` opens a new tab, not a popup window inside the same page.
  - The SQL Query dialog defaulted to `Audit Viewer (Default)`; the workbook flow required changing it to `ApplicationDB_FSCM`.
  - This tenant returned `COUNT___ (0)` for `SOURCE_BUSINESS_UNIT_ID=300000062878105` during the live run.
