@echo off
REM Double-click this (or run it) to start the AVTP xAI proxy on http://localhost:8787.
REM Keep this window OPEN while training. Close it to stop the proxy.
cd /d "%~dp0"
"C:\Users\amrita.mandal\Downloads\node-v22.16.0-win-x64\node-v22.16.0-win-x64\node.exe" --env-file=.env index.mjs
pause
