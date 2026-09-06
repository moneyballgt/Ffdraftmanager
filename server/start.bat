@echo off
REM Windows launcher: double-click this file.
cd /d "%~dp0"
node server.js %*
pause
