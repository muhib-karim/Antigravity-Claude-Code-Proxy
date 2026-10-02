#!/bin/bash
# Claude Code with auto-session - per-folder model persistence
# Sets session ID based on current directory

export CLAUDE_SESSION_ID=$(pwd | tr '/\\:' '_')
export ANTHROPIC_BASE_URL="http://localhost:8080"
# Claude Code sends ANTHROPIC_CUSTOM_HEADERS with every request; the proxy reads X-Session-ID
export ANTHROPIC_CUSTOM_HEADERS="X-Session-ID: ${CLAUDE_SESSION_ID}"
claude "$@"
