# Static + build validation for Intune Playwright tests.
# Legacy Intune/C# validator. Not part of the active Oracle OIC Java/Maven workflow.
# Runs forbidden-pattern checks then a dotnet build when explicitly invoked for legacy artifacts.
# Pass -Run to also execute tests in headed mode.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ProjectPath,
    [string] $TestFilter,
    [switch] $Run
)

$ErrorActionPreference = 'Stop'

Write-Host '==> Static checks for forbidden patterns' -ForegroundColor Cyan

$rules = @(
    [pscustomobject]@{ Pattern = 'Thread\.Sleep'; Reason = 'Hard wait — use web-first assertions' }
    [pscustomobject]@{ Pattern = 'WaitForTimeoutAsync'; Reason = 'Hard wait — use Expect(...).ToBeVisibleAsync()' }
    [pscustomobject]@{ Pattern = 'waitForTimeout\s*\('; Reason = 'Hard wait (TS) — use expect().toBeVisible()' }
    [pscustomobject]@{ Pattern = 'Page\.Locator\("css='; Reason = 'Raw CSS — prefer GetByRole / GetByLabel' }
    [pscustomobject]@{ Pattern = 'Page\.Locator\("xpath='; Reason = 'XPath — prefer GetByRole / GetByLabel' }
    [pscustomobject]@{ Pattern = 'IsVisibleAsync\(\)\s*&&'; Reason = 'Polling on IsVisibleAsync — use Expect()' }
)

$violations = New-Object System.Collections.Generic.List[object]
$files = Get-ChildItem -Path $ProjectPath -Recurse -File -Include *.cs,*.ts,*.js |
    Where-Object { $_.FullName -notmatch '\\(bin|obj|node_modules)\\' }

foreach ($file in $files) {
    $content = Get-Content -Raw -LiteralPath $file.FullName

    foreach ($rule in $rules) {
        if ($content -match $rule.Pattern) {
            $violations.Add([pscustomobject]@{
                File = $file.FullName.Substring($ProjectPath.Length).TrimStart('\', '/')
                Pattern = $rule.Pattern
                Reason = $rule.Reason
            })
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Host 'FAILED — forbidden patterns found:' -ForegroundColor Red
    $violations | Format-Table -AutoSize
    exit 1
}

Write-Host 'OK — no forbidden patterns' -ForegroundColor Green
Write-Host '==> dotnet build' -ForegroundColor Cyan

Push-Location $ProjectPath
try {
    dotnet build --nologo -v minimal
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    if ($Run) {
        Write-Host '==> dotnet test (headed)' -ForegroundColor Cyan
        $env:HEADED = '1'
        if ($TestFilter) {
            dotnet test --no-build --filter $TestFilter
        }
        else {
            dotnet test --no-build
        }

        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

Write-Host 'Validation complete.' -ForegroundColor Green
