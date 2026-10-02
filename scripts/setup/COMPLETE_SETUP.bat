@echo off
color 0A
title Antigravity Claude Proxy - Complete Setup

echo.
echo ================================================================
echo   Antigravity Claude Proxy - Complete Setup
echo ================================================================
echo.
echo This script will help you set up multiple Google AI accounts
echo for use with Claude Code CLI through the Antigravity proxy.
echo.
echo What has already been done for you:
echo   ✓ Environment variables configured
echo   ✓ Claude Code settings configured
echo.
echo What you need to do:
echo   1. Add your Google accounts
echo   2. Start the proxy server
echo   3. Test the setup
echo.
echo ================================================================
echo.
pause

:MENU
cls
color 0A
echo.
echo ================================================================
echo   Main Menu - Choose an option:
echo ================================================================
echo.
echo   1. Add Google AI Account (OAuth)
echo   2. Start Proxy Server
echo   3. Check Account Status
echo   4. Test Proxy Health
echo   5. Test Claude Code
echo   6. Open Step-by-Step Guide
echo   0. Exit
echo.
echo ================================================================
echo.

set /p choice="Enter your choice (0-6): "

if "%choice%"=="1" goto ADD_ACCOUNT
if "%choice%"=="2" goto START_PROXY
if "%choice%"=="3" goto CHECK_ACCOUNTS
if "%choice%"=="4" goto TEST_HEALTH
if "%choice%"=="5" goto TEST_CLAUDE
if "%choice%"=="6" goto OPEN_GUIDE
if "%choice%"=="0" goto EXIT
goto MENU

:ADD_ACCOUNT
cls
echo.
echo ================================================================
echo   Adding Google AI Account
echo ================================================================
echo.
echo This will open your browser for OAuth authentication.
echo Make sure to sign in with the Google account you want to add.
echo.
echo The browser will open to accounts.google.com
echo Sign in, grant permissions, then close the browser.
echo.
pause
echo.
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
npm run accounts:add
echo.
echo Account added! You can add more accounts by running this option again.
echo.
pause
goto MENU

:START_PROXY
cls
echo.
echo ================================================================
echo   Starting Proxy Server (PM2)
echo ================================================================
echo.
echo Checking if PM2 is installed...
where pm2 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Installing PM2 globally...
    npm install -g pm2
)
echo.
echo Starting proxy with PM2 (runs in background)...
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
pm2 stop antigravity-proxy 2>nul
pm2 delete antigravity-proxy 2>nul
pm2 start src/index.js --name antigravity-proxy
pm2 save
echo.
echo ================================================================
echo   Proxy is running in background!
echo ================================================================
echo.
echo   Dashboard: http://localhost:8080/dashboard
echo   The proxy will keep running even if you close this window.
echo   To stop: pm2 stop antigravity-proxy
echo.
echo Current PM2 status:
pm2 list
echo.
pause
goto MENU

:CHECK_ACCOUNTS
cls
echo.
echo ================================================================
echo   Checking Account Status
echo ================================================================
echo.
echo Checking configured accounts...
echo.
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
npm run accounts:list
echo.
echo ================================================================
echo   Verifying Accounts
echo ================================================================
echo.
npm run accounts:verify
echo.
pause
goto MENU

:TEST_HEALTH
cls
echo.
echo ================================================================
echo   Testing Proxy Health
echo ================================================================
echo.
echo Testing proxy server connection...
echo.
curl -s http://localhost:8080/health
echo.
echo.
echo ================================================================
echo   Account Limits
echo ================================================================
echo.
curl -s "http://localhost:8080/account-limits?format=table"
echo.
echo.
pause
goto MENU

:TEST_CLAUDE
cls
echo.
echo ================================================================
echo   Testing Claude Code
echo ================================================================
echo.
echo This will test if Claude Code CLI works with the proxy.
echo.
echo Make sure:
echo   1. The proxy server is running (START_PROXY option)
echo   2. You've added at least one Google account
echo   3. Claude Code CLI is installed
echo.
pause
echo.
echo Running: claude --version
claude --version
echo.
echo Running: claude
echo (Press Ctrl+C to exit if it starts)
echo.
claude
pause
goto MENU

:OPEN_GUIDE
cls
echo.
echo ================================================================
echo   Opening Setup Guide
echo ================================================================
echo.
echo Opening STEP_BY_STEP_SETUP.md...
echo.
start notepad "STEP_BY_STEP_SETUP.md"
pause
goto MENU

:EXIT
cls
color 07
echo.
echo ================================================================
echo   Setup Complete!
echo ================================================================
echo.
echo You can now use Claude Code CLI with multiple Google accounts.
echo.
echo Remember:
echo   1. Proxy runs in background via PM2
echo   2. Add all your Google accounts  
echo   3. Run 'claude' in any terminal
echo.
echo Thank you for using Antigravity Claude Proxy!
echo.
pause
exit