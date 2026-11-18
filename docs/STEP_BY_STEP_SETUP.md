# Step-by-Step Setup Guide

## What's Already Done ✅

I've already configured the following for you:

1. ✅ **Environment Variables**: 
   - `ANTHROPIC_BASE_URL=http://localhost:8080`
   - `ANTHROPIC_API_KEY=test`

2. ✅ **Claude Code Settings**: Created `%USERPROFILE%\.claude\settings.json` with proxy configuration

## What You Need to Do Next

### Step 1: Add Your Google AI Accounts

Open a Command Prompt as Administrator and navigate to the project:

```cmd
cd "C:\Users\YourUser\Desktop\Projects\Antigravity-Claude-Code-Proxy\Antigravity-Claude-Code-Proxy"
```

**For each Google account you want to use:**

1. Run this command:
   ```cmd
   npm run accounts:add
   ```

2. Your browser will open to Google's OAuth page

3. Sign in to your Google account

4. Click "Allow" to grant permissions

5. Close the browser tab

6. Repeat for each additional account

**Alternative: Use the batch file**
- Double-click `ADD_ACCOUNT.bat`

### Step 2: Start the Proxy Server

**Option 1: Using the batch file**
- From `Antigravity-Claude-Code-Proxy\Antigravity-Claude-Code-Proxy`, run `..\scripts\startup\start-proxy.bat` (or `npm start` there)

**Option 2: Using Command Prompt**
```cmd
cd "C:\Users\YourUser\Desktop\Projects\Antigravity-Claude-Code-Proxy\Antigravity-Claude-Code-Proxy"
npm start
```

**Keep this Command Prompt window open!** The proxy must stay running to use Claude Code.

### Step 3: Verify Setup

Open a **new** Command Prompt and test:

```cmd
# Check if proxy is running
curl http://localhost:8080/health

# Check your accounts
curl "http://localhost:8080/account-limits?format=table"

# Test Claude Code
claude
```

### Step 4: Use in VSCode

1. **Open VSCode**

2. **Open integrated terminal**: Press ``Ctrl + ` `` (backtick key)

3. **Check environment variables**:
   ```bash
   echo $ANTHROPIC_BASE_URL
   echo $ANTHROPIC_API_KEY
   ```
   Should show: `http://localhost:8080` and `test`

4. **Run Claude Code**:
   ```bash
   claude
   ```

## Available Models

- `claude-opus-4-5-thinking` (recommended - most capable)
- `claude-sonnet-4-5-thinking` (balanced performance)
- `claude-sonnet-4-5` (without thinking)
- `gemini-3-pro-high` (if you prefer Gemini)
- `gemini-3-flash` (faster responses)

## Troubleshooting

### If Environment Variables Don't Work

1. **Restart your terminal/VSCode** completely

2. **Manual check in Command Prompt**:
   ```cmd
   echo %ANTHROPIC_BASE_URL%
   echo %ANTHROPIC_API_KEY%
   ```

3. **If they don't show up**, run `SETUP_ENV_VARIABLES.bat` as Administrator

### If Claude Code Doesn't Work

1. **Check the proxy is running** - ensure the npm start window is open

2. **Test the proxy directly**:
   ```cmd
   curl http://localhost:8080/health
   ```
   Should return: `{"status":"ok"}`

3. **Check account status**:
   ```cmd
   curl "http://localhost:8080/account-limits?format=table"
   ```

### If OAuth Fails

1. **Clear browser cache** for accounts.google.com

2. **Try incognito/private mode**

3. **Re-add the account**:
   ```cmd
   npm run accounts:add
   ```

## Quick Reference

| Action | Command |
|--------|---------|
| Add account | `npm run accounts:add` |
| List accounts | `npm run accounts:list` |
| Start proxy | `npm start` |
| Check health | `curl http://localhost:8080/health` |
| Check accounts | `curl "http://localhost:8080/account-limits?format=table"` |
| Use Claude | `claude` |

## Batch Files Created

- `SETUP_ENV_VARIABLES.bat` - Sets up environment variables
- `scripts/startup/start-proxy.bat` - Starts the proxy server
- `ADD_ACCOUNT.bat` - Adds a Google account via OAuth
- `npm run accounts:list` - Checks account status
- `npm run doctor` - Checks proxy health (or `curl http://localhost:8080/health` while the proxy runs)

## Next Steps

Once you've added your accounts and started the proxy:

1. **Open VSCode**
2. **Open integrated terminal** (``Ctrl + ` ``)
3. **Run**: `claude`
4. **Start using** Claude Code through the proxy.

The proxy will automatically:
- Keep requests on a stable session
- Fail over when a session is unavailable
- Maintain session continuity for better performance
