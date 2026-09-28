@echo off
title Add Multiple Google AI Accounts
color 0B

echo.
echo ================================================================
echo   Adding Multiple Google AI Accounts
echo ================================================================
echo.
echo This will help you add multiple Google accounts to maximize quota.
echo.
echo CURRENT STATUS:
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
npm run accounts:list
echo.
pause

echo.
echo ================================================================
echo   Instructions for Adding Accounts
echo ================================================================
echo.
echo Step 1: The proxy server will stop automatically
echo Step 2: Your browser will open to Google OAuth
echo Step 3: Sign in with a DIFFERENT Google account
echo Step 4: Grant permissions
echo Step 5: Close browser and return here
echo Step 6: Repeat for each additional account
echo.
echo IMPORTANT: Use DIFFERENT Google accounts for maximum quota!
echo.
pause

echo.
echo Starting account addition process...
echo.
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"

echo.
echo If the browser doesn't open automatically, you'll need to manually
echo run: npm run accounts:add
echo.

npm run accounts:add

if errorlevel 1 (
    echo.
    echo There was an issue. Let me try again...
    echo.
    npm run accounts
) else (
    echo.
    echo Account added successfully!
    echo.
    echo Current accounts:
    npm run accounts:list
)

echo.
echo ================================================================
echo   Setup Complete!
echo ================================================================
echo.
echo You can now start the proxy server with multiple accounts:
echo.
echo Option 1: Double-click START_PROXY.bat
echo Option 2: Run: npm start
echo.
pause