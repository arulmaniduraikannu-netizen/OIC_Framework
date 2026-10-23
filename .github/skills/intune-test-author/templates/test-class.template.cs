// Source: <learn.microsoft.com URL>
// Test case: TC#<id> — <title>
using IntuneTests.PageObjects;
using IntuneTests.Utilities;
using Microsoft.Playwright.NUnit;
using NUnit.Framework;

namespace IntuneTests.Tests.<Feature>;

[TestFixture]
[Category("Regression")]
[Category("<Platform>")]   // e.g., iOS, Android, Windows
[Category("<Feature>")]    // e.g., WebClip, Compliance
public class <Scenario>Tests : PageTest
{
    private <FeatureName>Page _page = null!;
    private TestDataRoot _data = null!;

    [SetUp]
    public async Task SetUp()
    {
        _data = TestDataLoader.Load<TestDataRoot>("<feature>/<scenario>.testdata.json");
        _page = new <FeatureName>Page(Page);
        await _page.NavigateAsync();
    }

    [Test]
    [Description("TC#<id>: <one-line description>")]
    public async Task TC<id>_<MethodName>()
    {
        // Arrange — values from JSON
        // Act — call POM methods
        // Assert — web-first assertions only
    }

    [TearDown]
    public async Task CleanUp()
    {
        // Always clean up created entities, even on failure
    }
}
