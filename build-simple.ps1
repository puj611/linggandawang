# Simple build script without Chinese characters to avoid encoding issues
$ErrorActionPreference = "Continue"
$env:Path = "d:\puj\download;" + $env:Path
Set-Location "d:\AI工作平台\灵感大王"
Write-Host "Starting Tauri build..." -ForegroundColor Yellow
npx tauri build
Write-Host ""
Write-Host "Build finished! Check src-tauri\target\release\bundle\" -ForegroundColor Green
