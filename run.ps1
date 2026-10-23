<#
.SYNOPSIS
    Automates OmniRoute verification and launches Claude Code with proper environment settings.
.DESCRIPTION
    1. Checks if OmniRoute is active on port 20128.
    2. Opens the dashboard if needed.
    3. Exports required ANTHROPIC environment variables.
    4. Launches the Claude Code CLI.
#>

# 1. Define Server Configuration
$omniRouteUrl = "http://localhost:20128"
$env:ANTHROPIC_BASE_URL = "$omniRouteUrl/v1"
$env:ANTHROPIC_API_KEY = "omniroute"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " OmniRoute + Claude Code Windows Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 2. Test Connection to OmniRoute Port 20128
$connectionTest = Test-NetConnection -ComputerName "localhost" -Port 20128 -InformationLevel Quiet

if (-not $connectionTest) {
    Write-Host "[!] OmniRoute server is not running on port 20128." -ForegroundColor Red
    Write-Host "--> Starting OmniRoute background process..." -ForegroundColor Yellow
    Start-Process -FilePath "omniroute" -NoNewWindow
    Start-Sleep -Seconds 3
} else {
    Write-Host "[✓] OmniRoute server detected on port 20128!" -ForegroundColor Green
}

# 3. Environment Variables Set Successfully
Write-Host "[✓] ANTHROPIC_BASE_URL set to: $env:ANTHROPIC_BASE_URL" -ForegroundColor Gray
Write-Host "[✓] ANTHROPIC_API_KEY set to: $env:ANTHROPIC_API_KEY" -ForegroundColor Gray

# 4. Launch Claude Code CLI
Write-Host "`nLaunching Claude Code CLI..." -ForegroundColor Green
claude