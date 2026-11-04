#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not (Test-Path "$Root\config.json")) {
  Copy-Item "$Root\config.example.json" "$Root\config.json"
  Write-Host "Created config.json from example. Edit it before chatting."
}

Write-Host "Building..."
pnpm build

Write-Host "Starting bridge (foreground). Run console in another terminal: pnpm console"
pnpm bridge
