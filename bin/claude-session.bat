@echo off
REM Claude Code with auto-session - per-folder model persistence
REM Sets session ID based on current directory

set "CLAUDE_SESSION_ID=%CD:\=_%"
set "CLAUDE_SESSION_ID=%CLAUDE_SESSION_ID::=_%"
set "ANTHROPIC_BASE_URL=http://localhost:8080"
REM Claude Code sends ANTHROPIC_CUSTOM_HEADERS with every request; the proxy reads X-Session-ID
set "ANTHROPIC_CUSTOM_HEADERS=X-Session-ID: %CLAUDE_SESSION_ID%"
claude %*
