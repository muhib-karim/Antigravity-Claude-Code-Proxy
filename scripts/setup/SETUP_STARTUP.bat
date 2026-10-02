@echo off
setlocal
echo ============================================
echo   Antigravity Proxy - Auto-Start Setup
echo ============================================
echo.

:: Check if PM2 is installed
where pm2 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo PM2 not found. Installing PM2 globally...
    echo.
    call npm install -g pm2
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install PM2. Please run: npm install -g pm2
        pause
        exit /b 1
    )
    echo PM2 installed successfully!
    echo.
)

:: Get the proxy directory (relative to this script)
set "SCRIPT_DIR=%~dp0"
set "PROXY_DIR=%SCRIPT_DIR%..\..\Antigravity-Claude-Code-Proxy"

:: Check if proxy directory exists
if not exist "%PROXY_DIR%\src\index.js" (
    echo ERROR: Could not find index.js at %PROXY_DIR%\src\index.js
    echo Please run this script from the scripts\setup folder.
    pause
    exit /b 1
)

:: Stop any existing proxy instance
echo Stopping any existing proxy instance...
pm2 stop antigravity-proxy 2>nul
pm2 delete antigravity-proxy 2>nul

:: Start proxy with PM2
echo.
echo Starting proxy with PM2...
cd /d "%PROXY_DIR%"
pm2 start src/index.js --name antigravity-proxy

:: Save PM2 process list
echo.
echo Saving PM2 process list...
pm2 save

:: Create startup batch file in Windows Startup folder
set "STARTUP_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\antigravity-proxy-startup.bat"

echo.
echo Creating Windows startup script...
(
echo @echo off
echo cd /d "%PROXY_DIR%"
echo pm2 resurrect
) > "%STARTUP_FILE%"

echo.
echo ============================================
echo   SUCCESS! Auto-start configured
echo ============================================
echo.
echo   - Proxy registered with PM2
echo   - PM2 process list saved
echo   - Will auto-start on Windows login
echo.
echo   Dashboard: http://localhost:8080/dashboard
echo.
echo ============================================
echo.
echo Current PM2 status:
pm2 list
echo.
pause
