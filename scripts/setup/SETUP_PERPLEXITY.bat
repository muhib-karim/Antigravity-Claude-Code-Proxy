@echo off
title Perplexity Account Setup
cd /d "%~dp0..\..\Antigravity-Claude-Code-Proxy"
echo Starting Perplexity Account Setup...
call npm run login:perplexity
echo.
echo Setup complete.
pause
