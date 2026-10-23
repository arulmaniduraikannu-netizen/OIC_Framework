// Source: <learn.microsoft.com URL from Phase 1>
// UI verified via Playwright MCP snapshot at <YYYY-MM-DD>
using Microsoft.Playwright;
using static Microsoft.Playwright.Assertions;

namespace IntuneTests.PageObjects;

public class <FeatureName>Page
{
    private readonly IPage _page;

    public <FeatureName>Page(IPage page) => _page = page;

    // ✅ Priority 1: getByRole — interactive elements
    private ILocator <ActionButton> => _page.GetByRole(AriaRole.Button, new() { Name = "<verified-name>" });

    // ✅ Priority 2: getByLabel — form fields
    private ILocator <FieldName>Input => _page.GetByLabel("<verified-label>");

    // ✅ Priority 4: getByText — non-interactive verification
    private ILocator <Notification> => _page.GetByText("<verified-text>");

    // Dynamic locator — scope to a row/card by its accessible name
    private ILocator <EntityRow>(string name) => _page.GetByRole(AriaRole.Row, new() { Name = name });

    public async Task NavigateAsync()
    {
        await _page.GotoAsync("https://intune.microsoft.com/<path>");
        await Expect(<ActionButton>).ToBeVisibleAsync();
    }

    public async Task PerformActionAsync(/* parameters */)
    {
        await <ActionButton>.ClickAsync();
        await <FieldName>Input.FillAsync("<value>");
        await Expect(<Notification>).ToBeVisibleAsync(new() { Timeout = 30000 });
    }

    public async Task<bool> IsPresentAsync(string name)
        => await <EntityRow>(name).IsVisibleAsync();
}
