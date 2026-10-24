param(
    [string]$MavenExecutable = "mvn",
    [switch]$CollectionOnly
)

$ErrorActionPreference = "Stop"

Write-Host "Running Oracle Fusion scheduled-process monitor cycle..." -ForegroundColor Cyan
& $MavenExecutable -f (Join-Path $PSScriptRoot "pom.xml") -q -DskipTests compile
if ($LASTEXITCODE -ne 0) {
    throw "Monitor compile failed with exit code $LASTEXITCODE."
}

$monitorArguments = @("-f", (Join-Path $PSScriptRoot "pom.xml"), "-q", "-Dtest=ScheduledProcessMonitorCycleTest")
$headless = if ($env:GITHUB_ACTIONS -eq "true") { "true" } else { "false" }
$monitorArguments += "-Ddefault.headless=$headless"
if ($CollectionOnly) {
    $monitorArguments += "-Doic.monitor.collectionOnly=true"
}
& $MavenExecutable @monitorArguments test
if ($LASTEXITCODE -ne 0) {
    throw "Monitor cycle failed with exit code $LASTEXITCODE."
}

Write-Host "Monitor cycle completed successfully." -ForegroundColor Green