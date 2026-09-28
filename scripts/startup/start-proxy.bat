@echo off
title Antigravity Claude Proxy
echo Starting Antigravity Claude Proxy...
echo.

:: Set the proxy directory
set PROXY_DIR=%~dp0..\..\Antigravity-Claude-Code-Proxy
set PYTHON_DIR=%~dp0..\..\perplexity-openai-api-ref

:: Check if proxy is already running
netstat -an | findstr ":8080.*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Proxy already running on port 8080
    goto :check_python
)

:: Start Node.js proxy in background
echo Starting Node.js proxy on port 8080...
start /min cmd /c "cd /d %PROXY_DIR% && npm start"
timeout /t 3 /nobreak >nul

:check_python
:: Check if Python server is already running
netstat -an | findstr ":8000.*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Python server already running on port 8000
    goto :done
)

:: Start Python Perplexity server in background
echo Starting Python Perplexity server on port 8000...
start /min cmd /c "cd /d %PYTHON_DIR% && python openai_server.py"
timeout /t 3 /nobreak >nul

:done
echo.
echo ============================================
echo   Antigravity Claude Proxy is READY!
echo   Dashboard: http://localhost:8080/dashboard
echo ============================================
echo.
echo You can now use 'claude' from any terminal.
echo Press any key to close this window...
pause >nul
