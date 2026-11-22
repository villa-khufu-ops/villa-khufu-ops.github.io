@echo off
cd /d "%~dp0"
echo stop> STOP-PRINT.txt
echo Print station will stop within a minute. Run print-station-setup.bat to turn it back on.
pause
