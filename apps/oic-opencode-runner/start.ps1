Set-Location $PSScriptRoot
$env:OIC_RUNNER_PORT = "3001"

Write-Host "Starting OIC OpenCode Runner..."
Write-Host "  Express API: http://127.0.0.1:3001"
Write-Host "  Vite UI:     http://127.0.0.1:5174"
Write-Host ""

Start-Process -FilePath "node" -ArgumentList "--import", "tsx", "src/server/index.ts" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Start-Sleep -Seconds 3
Start-Process -FilePath "node" -ArgumentList "node_modules/vite/bin/vite.js", "--host", "127.0.0.1" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Start-Sleep -Seconds 2

Write-Host "Servers started. Checking..."
$api = Test-NetConnection -ComputerName 127.0.0.1 -Port 3001 -WarningAction SilentlyContinue
$vite = Test-NetConnection -ComputerName 127.0.0.1 -Port 5174 -WarningAction SilentlyContinue

if ($api.TcpTestSucceeded) { Write-Host "  [OK] Express API on :3001" } else { Write-Host "  [FAIL] Express API not responding" }
if ($vite.TcpTestSucceeded) { Write-Host "  [OK] Vite UI on :5174" } else { Write-Host "  [FAIL] Vite not responding" }
