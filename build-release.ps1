# build-release.ps1
# 独立打包脚本 - 在普通PowerShell窗口中执行，绕过TRAE沙箱限制

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 灵感大王 - Release 打包脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$env:Path = "d:\puj\下载;" + $env:Path

Set-Location "d:\AI工作平台\灵感大王"

Write-Host "[1/4] 检查环境..." -ForegroundColor Yellow
Write-Host "  Node: $(node --version)"
Write-Host "  npm: $(npm --version)"
Write-Host "  rustc: $(rustc --version)"
Write-Host ""

Write-Host "[2/4] 清理旧的构建缓存..." -ForegroundColor Yellow
if (Test-Path "src-tauri\target\release\build") {
    Remove-Item -Recurse -Force "src-tauri\target\release\build"
    Write-Host "  已清理 release/build 目录" -ForegroundColor Green
}
Write-Host ""

Write-Host "[3/4] 开始 release 打包（预计需要3-5分钟）..." -ForegroundColor Yellow
Write-Host ""

try {
    npx tauri build
    Write-Host ""
    Write-Host "[4/4] 打包完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "安装包位置：" -ForegroundColor Cyan
    Write-Host "  src-tauri\target\release\bundle\msi\" -ForegroundColor White
    Write-Host "  src-tauri\target\release\bundle\nsis\" -ForegroundColor White
} catch {
    Write-Host ""
    Write-Host "打包失败：$_" -ForegroundColor Red
    Write-Host ""
    Write-Host "如果错误包含 操作成功完成，请在普通PowerShell窗口中运行此脚本" -ForegroundColor Yellow
}
