# Quick Start Guide

## Overview
This setup allows you to use multiple Google AI accounts with Claude Code CLI, maximizing your available quota.

## Files Created

1. **MULTI_GOOGLE_AI_ACCOUNTS_SETUP.md** - Complete setup guide
2. **scripts/startup/start-proxy.bat** - Double-click to start the proxy server
3. **ADD_ACCOUNT.bat** - Double-click to add a Google account
4. **npm run accounts:list** - Check account status

## Quick Setup Steps

### 1. Add Your Google Accounts
```bash
# Run this for each Google account you want to use
# Double-click ADD_ACCOUNT.bat or run:
cd Antigravity-Claude-Code-Proxy/Antigravity-Claude-Code-Proxy
npm run accounts:add
```

### 2. Start the Proxy Server
```bash
# Double-click scripts/startup/start-proxy.bat or run:
cd Antigravity-Claude-Code-Proxy/Antigravity-Claude-Code-Proxy
npm start
```

### 3. Configure Claude Code CLI
Edit `%USERPROFILE%\.claude\settings.json` and add:
```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-5",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-5-thinking"
  }
}
```

### 4. Use Claude Code
```bash
claude
```

## Available Commands

- **scripts/startup/start-proxy.bat** - Start the proxy server
- **ADD_ACCOUNT.bat** - Add a new Google account
- **npm run accounts:list** - Check account status
- **npm run doctor** - Check proxy health (or `curl http://localhost:8080/health` while the proxy runs)

## Troubleshooting

1. **Proxy not working**: Make sure the proxy is running (scripts/startup/start-proxy.bat or `npm start`)
2. **Authentication errors**: Re-add accounts using ADD_ACCOUNT.bat
3. **Rate limiting (429)**: Wait for the limit to reset; the dashboard shows each session's status

## Need Help?

See **MULTI_GOOGLE_AI_ACCOUNTS_SETUP.md** for detailed instructions.