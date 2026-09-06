@echo off
REM Windows launcher for OFFLINE MOCK mode: double-click this file.
cd /d "%~dp0"
node server.js --mock %*
pause
