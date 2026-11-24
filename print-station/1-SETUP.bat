@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Villa Khufu - Kitchen print setup
echo.
echo ===== Villa Khufu : kitchen printing on this laptop =====
echo.
set "NODE=node"
set "NPM=npm"
where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "NODE=%ProgramFiles%\nodejs\node.exe"
    set "NPM=%ProgramFiles%\nodejs\npm.cmd"
  ) else (
    echo [1/4] Installing Node.js ... please wait, and press Yes if Windows asks.
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if exist "%ProgramFiles%\nodejs\node.exe" (
      set "NODE=%ProgramFiles%\nodejs\node.exe"
      set "NPM=%ProgramFiles%\nodejs\npm.cmd"
    ) else (
      echo.
      echo Node.js did not install. Open https://nodejs.org , download the LTS version, install it, then run this file again.
      pause
      exit /b 1
    )
  )
)
echo [2/4] Preparing the program ...
set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
call "%NPM%" install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Could not download the program parts. Check the internet and run this file again.
  pause
  exit /b 1
)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-old.ps1"
echo [3/4] The Villa Khufu app window will open (if you are not logged in, log in).
echo       Then CLOSE the window - printing continues in the background.
echo.
"%NODE%" print-station.js --login
echo.
echo [4/4] Turning on automatic printing ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-station-setup.ps1"
echo.
echo DONE. Send a test order from a phone on mobile data.
pause
