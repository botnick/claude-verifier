@echo off
REM Launcher for Windows
cd /d "%~dp0"

where node >nul 2>nul
if not %ERRORLEVEL%==0 (
    echo Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo First-time setup - installing Electron ^(~200 MB, one time^)...
    call npm install
)

call npm start
