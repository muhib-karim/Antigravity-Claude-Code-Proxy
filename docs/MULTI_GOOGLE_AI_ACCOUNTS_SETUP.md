# Multiple Google AI Accounts Setup for Claude Code CLI

This guide will help you set up multiple Google AI accounts to use with Claude Code CLI through the Antigravity Claude Proxy. This allows you to leverage the quota from all your Google AI accounts effectively.

## Overview

The Antigravity Claude Proxy acts as a bridge between Claude Code CLI and Google's AI services. It supports multiple Google accounts and automatically balances the load between them, maximizing your available quota.

### How It Works

```
Claude Code CLI → Antigravity Claude Proxy → Multiple Google AI Accounts
                                      ↓
                               Session Management + Failover
```

## Prerequisites

1. **Node.js 22.13 or later** installed on your system
2. **Multiple Google AI accounts** with available quota
3. **Claude Code CLI** installed

## Step-by-Step Setup

### Step 1: Navigate to the Project Directory

```bash
cd antigravity-claude-proxy-main
```

### Step 2: Install Dependencies (Already Done)

The dependencies have been installed successfully. If you need to reinstall:

```bash
npm install
```

### Step 3: Add Multiple Google AI Accounts

Use the following command to add your first Google account:

```bash
npm run accounts:add
```

This will:
1. Open your default browser
2. Redirect you to Google's OAuth page
3. Ask you to sign in to your Google account
4. Request permission to access your account

**Repeat this process for each additional Google account you want to add:**

```bash
npm run accounts:add  # Add 2nd account
npm run accounts:add  # Add 3rd account
# ... continue for all your accounts
```

### Step 4: Verify Your Accounts

Check that all your accounts are properly configured:

```bash
npm run accounts:list
```

You should see a list like:

```
✓ account1@gmail.com - Active
✓ account2@gmail.com - Active  
✓ account3@gmail.com - Active
```

Verify the tokens are working:

```bash
npm run accounts:verify
```

### Step 5: Start the Proxy Server

Start the proxy server:

```bash
npm start
```

The server will run on `http://localhost:8080` by default.

**To use a different port:**

```bash
PORT=3000 npm start
```

### Step 6: Configure Claude Code CLI

Create or edit your Claude Code settings file:

**Windows:**
```cmd
notepad %USERPROFILE%\.claude\settings.json
```

**macOS/Linux:**
```bash
nano ~/.claude/settings.json
```

Add this configuration:

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

**Alternative: Use Gemini models:**

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "gemini-3-pro-high",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "gemini-3-pro-high",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gemini-3-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gemini-2.5-flash-lite",
    "CLAUDE_CODE_SUBAGENT_MODEL": "gemini-3-flash"
  }
}
```

### Step 7: Set Environment Variables

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:8080"
$env:ANTHROPIC_API_KEY = "test"
```

**Windows (Command Prompt):**
```cmd
set ANTHROPIC_BASE_URL=http://localhost:8080
set ANTHROPIC_API_KEY=test
```

**macOS/Linux:**
```bash
export ANTHROPIC_BASE_URL="http://localhost:8080"
export ANTHROPIC_API_KEY="test"
```

### Step 8: Test the Setup

1. **Check proxy health:**
   ```bash
   curl http://localhost:8080/health
   ```

2. **Check account limits:**
   ```bash
   curl "http://localhost:8080/account-limits?format=table"
   ```

3. **Test with Claude Code:**
   ```bash
   claude
   ```

## Available Models

### Claude Models
- `claude-opus-4-5-thinking` - Claude Opus 4.5 with extended thinking
- `claude-sonnet-4-5-thinking` - Claude Sonnet 4.5 with extended thinking
- `claude-sonnet-4-5` - Claude Sonnet 4.5 without thinking

### Gemini Models
- `gemini-3-pro-high` - Gemini 3 Pro High with thinking
- `gemini-3-pro-low` - Gemini 3 Pro Low with thinking
- `gemini-3-flash` - Gemini 3 Flash with thinking

## Account Management Commands

```bash
# List all accounts
npm run accounts:list

# Add a new account
npm run accounts:add

# Remove accounts interactively
npm run accounts:remove

# Verify all accounts
npm run accounts:verify

# Clear all accounts
npm run accounts:clear
```

## Session Management Features

The proxy automatically:
- **Sticky account selection**: Stays on the same account to maximize prompt cache hits
- **Smart rate limit handling**: Waits for short rate limits (≤2 min), switches accounts for longer ones
- **Automatic cooldown**: Rate-limited accounts become available after reset time expires
- **Invalid account detection**: Accounts needing re-authentication are marked and skipped
- **Prompt caching support**: Stable session IDs enable cache hits across conversation turns

## Monitoring and Troubleshooting

### Check Account Status

```bash
curl "http://localhost:8080/account-limits?format=table"
```

### Refresh Tokens

If you get authentication errors:

```bash
curl -X POST http://localhost:8080/refresh-token
```

### Re-authenticate an Account

```bash
npm run accounts
# Choose the account to re-authenticate
```

## Important Notes

1. **Always keep the proxy server running** when using Claude Code CLI
2. **Multiple terminals**: Run the proxy in one terminal and Claude Code in another
3. **Account limits**: Each Google account has its own quota limits
4. **Automatic failover**: The proxy moves to another session if the current one is unavailable
5. **Security**: OAuth tokens are stored locally and used for API authentication

## Troubleshooting

### "Could not extract token from Antigravity"
- Make sure you've added accounts via OAuth: `npm run accounts:add`

### 401 Authentication Errors
- Try refreshing tokens: `curl -X POST http://localhost:8080/refresh-token`
- Re-authenticate the account: `npm run accounts`

### Rate Limiting (429)
- With multiple accounts, the proxy automatically switches accounts
- With a single account, wait for the rate limit to reset

### Account Shows as "Invalid"
```bash
npm run accounts
# Choose "Re-authenticate" for the invalid account
```

## Quick Reference

```bash
# Start proxy server
npm start

# Add accounts
npm run accounts:add

# List accounts
npm run accounts:list

# Verify accounts
npm run accounts:verify

# Check health
curl http://localhost:8080/health

# Check account limits
curl "http://localhost:8080/account-limits?format=table"
```

## Usage Example

1. Start the proxy: `npm start`
2. In another terminal, use Claude Code: `claude`
3. The proxy will automatically use your multiple Google accounts
4. Enjoy extended quota from all your accounts!

---

**Disclaimer**: This setup uses multiple Google AI accounts to maximize quota usage. Please ensure compliance with Google's Terms of Service and use responsibly.