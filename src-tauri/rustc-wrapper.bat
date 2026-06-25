@echo off
if "%1"=="--version" (
  echo rustc 1.96.0 ^(ac68faa20 2026-05-25^)
  echo binary: rustc
  echo commit-hash: ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96
  echo commit-date: 2026-05-25
  echo host: x86_64-pc-windows-msvc
  echo release: 1.96.0
  echo LLVM version: 22.1.2
  exit /b 0
)
"C:\Users\puj\.cargo\bin\rustc.exe" %*