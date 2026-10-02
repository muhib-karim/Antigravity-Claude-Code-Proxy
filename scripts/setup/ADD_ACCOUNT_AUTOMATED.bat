@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title Adding New Google Account - Claude Code CLI
color 0A

echo ╔══════════════════════════════════════════════════════════════════════╗
echo ║         Automated Account Addition for Claude Code CLI               ║
echo ╚══════════════════════════════════════════════════════════════════════╝
echo.

REM Step 1: Kill any running node processes
echo [1/5] Checking for running processes...
taskkill /f /im node.exe >nul 2>&1
echo ✓ Stopped any running processes
echo.

REM Step 2: Navigate to project directory
echo [2/5] Navigating to project directory...
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
echo ✓ Current directory: %CD%
echo.

REM Step 3: Show current accounts
echo [3/5] Current accounts:
node src/accounts-cli.js list
echo.

REM Step 4: Start the account addition process
echo [4/5] Starting account addition...
echo ╔══════════════════════════════════════════════════════════════════════╗
echo ║  ⚠️  IMPORTANT: Browser will open for Google sign-in                 ║
echo ║  1. Sign in with a DIFFERENT Google account                          ║
echo ║  2. Grant permissions                                                ║
echo ║  3. Close browser after authentication                               ║
echo ╚══════════════════════════════════════════════════════════════════════╝
echo.
echo Press any key to start the Google sign-in process...
pause >nul

echo.
echo Starting OAuth server and opening browser...
echo.
node src/accounts-cli.js add

REM Step 5: Verify the new account
echo.
echo [5/5] Verifying new account:
node src/accounts-cli.js list
echo.

echo ╔══════════════════════════════════════════════════════════════════════╗
echo ║  ✅ Account addition process complete!                               ║
echo ║                                                                      ║
echo ║  To start using Claude Code with multiple accounts:                  ║
echo ║    npm start                                                         ║
echo ║                                                                      ║
echo ║  Then in another terminal, use: claude "your request"               ║
echo ╚══════════════════════════════════════════════════════════════════════╝
echo.
pause
endlocal
