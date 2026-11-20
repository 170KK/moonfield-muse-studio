@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在重启 Muse Studio 服务...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_muse_studio.ps1" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_muse_studio.ps1"
if errorlevel 1 (
  echo.
  pause
)
