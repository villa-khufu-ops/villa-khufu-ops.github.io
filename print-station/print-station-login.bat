@echo off
cd /d "%~dp0"
echo Log in to the Villa Khufu app in the window that opens, then CLOSE the window.
node print-station.js --login
pause
