# Troubleshooting Guide

This guide helps diagnose and resolve common issues with Antigravity Claude Proxy.

## Quick Diagnostics

Run the doctor script to check your setup:

```bash
npm run doctor
```

This checks:
- Node.js version (requires 22.13+)
- Dependencies installed
- Environment configuration
- Account configuration
- Network connectivity

---

## Common Issues

### 1. "No accounts available" Error

**Symptoms:**
- Error message: `No accounts available`
- Requests fail immediately without retrying

**Causes:**
- No Google accounts configured
- All accounts have invalid tokens
- Account configuration file is missing or corrupted

**Solutions:**

1. Add a Google account:
   ```bash
   npm run accounts:add
   ```

2. Verify existing accounts:
   ```bash
   npm run accounts:verify
   ```

3. List accounts to check status:
   ```bash
   npm run accounts:list
   ```

4. Check account file location:
   - Windows: `%USERPROFILE%\.config\antigravity-proxy\accounts.json`
   - macOS/Linux: `~/.config/antigravity-proxy/accounts.json`

---

### 2. Rate Limit Errors

**Symptoms:**
- Error: `RESOURCE_EXHAUSTED: Rate limited`
- Requests fail with 429 status code

**Causes:**
- Exceeded Google API quota
- All accounts are rate-limited simultaneously

**Solutions:**

1. **Enable Auto-Wait Mode** (recommended):
   The proxy now supports automatic waiting for rate limits to reset.

   In your `.env` file:
   ```env
   AUTO_WAIT_FOR_RATE_LIMIT=true
   ```

   When enabled, the proxy will:
   - Automatically detect rate limit reset time
   - Wait with progress updates every 30 seconds
   - Resume automatically when the rate limit resets

2. **Add more accounts:**
   The proxy load-balances across multiple accounts:
   ```bash
   npm run accounts:add
   ```

3. **Check account limits:**
   ```bash
   curl http://localhost:8080/account-limits
   ```

4. **Configure wait behavior:**
   ```env
   # Progress update interval during waits (default: 30 seconds)
   RATE_LIMIT_PROGRESS_INTERVAL=30000

   # Maximum wait time (0 = unlimited)
   MAX_RATE_LIMIT_WAIT=0
   ```

---

### 3. Authentication Failures

**Symptoms:**
- Error: `401 Unauthorized`
- Error: `Invalid credentials`
- Token refresh failures

**Causes:**
- Expired refresh tokens
- Revoked Google account access
- Invalid OAuth configuration

**Solutions:**

1. Re-authenticate the affected account:
   ```bash
   npm run accounts:add
   ```
   (Add the same email to refresh its tokens)

2. Remove and re-add the account:
   ```bash
   npm run accounts:remove
   npm run accounts:add
   ```

3. Check Google account permissions:
   - Go to https://myaccount.google.com/permissions
   - Look for "Antigravity" and ensure it has access

4. Verify OAuth configuration:
   - If using custom OAuth credentials, check `.env`:
     ```env
     GOOGLE_OAUTH_CLIENT_ID=your-client-id
     GOOGLE_OAUTH_CLIENT_SECRET=your-secret
     ```

---

### 4. Connection Timeouts

**Symptoms:**
- Error: `Request timeout after 60000ms`
- Requests hang and eventually fail

**Causes:**
- Network connectivity issues
- Firewall blocking connections
- Slow or unresponsive API servers

**Solutions:**

1. Check network connectivity:
   ```bash
   curl -I https://cloudcode-pa.googleapis.com
   ```

2. Increase timeout (in `.env`):
   ```env
   REQUEST_TIMEOUT=120000  # 2 minutes
   ```

3. Check firewall/proxy settings:
   - Ensure outbound HTTPS is allowed
   - Check corporate proxy configuration

4. Try different endpoints:
   The proxy automatically falls back between:
   - `daily-cloudcode-pa.sandbox.googleapis.com`
   - `cloudcode-pa.googleapis.com`

---

### 5. "better-sqlite3" Installation Errors

**Symptoms:**
- npm install fails with node-gyp errors
- Module compilation failures

**Causes:**
- Missing build tools
- Node.js version mismatch
- Python not installed

**Solutions:**

**Windows:**
```bash
npm install --global windows-build-tools
npm install
```

**macOS:**
```bash
xcode-select --install
npm install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get install build-essential python3
npm install
```

---

### 6. Port Already in Use

**Symptoms:**
- Error: `EADDRINUSE: address already in use`
- Server fails to start

**Solutions:**

1. Find and kill the process using the port:

   **Windows:**
   ```bash
   netstat -ano | findstr :8080
   taskkill /PID <pid> /F
   ```

   **macOS/Linux:**
   ```bash
   lsof -i :8080
   kill -9 <pid>
   ```

2. Use a different port (in `.env`):
   ```env
   PORT=8081
   ```

---

### 7. Streaming Issues

**Symptoms:**
- Streaming responses cut off prematurely
- Incomplete thinking blocks
- Missing tool use responses

**Causes:**
- Network interruptions
- Timeout during long responses

**Solutions:**

1. The proxy uses 5x normal timeout for streaming (300 seconds by default)

2. If responses are still timing out, increase the base timeout:
   ```env
   REQUEST_TIMEOUT=120000
   ```

3. Check for network stability issues

---

### 8. Thinking Signature Errors

**Symptoms:**
- Error: `Invalid thinking signature`
- Multi-turn conversations fail after tool use

**Causes:**
- Claude Code stripping thoughtSignature field
- Signature cache miss

**Solutions:**

1. The proxy automatically caches signatures and uses a skip sentinel
2. Ensure you're using the latest proxy version
3. Check cache TTL setting:
   ```env
   GEMINI_SIGNATURE_CACHE_TTL=7200000  # 2 hours
   ```

---

## Debug Logging

Enable verbose logging to diagnose issues:

```env
LOG_LEVEL=debug
```

Log levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`

---

## Health Check

Verify the proxy is running:

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "accounts": {
    "total": 2,
    "available": 2,
    "rateLimited": 0
  }
}
```

---

## Getting Help

1. Check existing issues: https://github.com/badri-s2001/antigravity-claude-proxy/issues

2. Run the doctor script and include output when reporting issues:
   ```bash
   npm run doctor > doctor-output.txt 2>&1
   ```

3. Include relevant log output (with sensitive data redacted)

---

## Environment Variable Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `REQUEST_TIMEOUT` | `60000` | Request timeout in ms |
| `AUTO_WAIT_FOR_RATE_LIMIT` | `true` | Auto-wait for rate limits |
| `RATE_LIMIT_PROGRESS_INTERVAL` | `30000` | Progress update interval |
| `MAX_RATE_LIMIT_WAIT` | `0` | Max wait time (0=unlimited) |
| `MAX_RETRIES` | `5` | Max retry attempts |
| `TOKEN_REFRESH_INTERVAL` | `300000` | Token refresh interval |
| `RATE_LIMIT_COOLDOWN` | `60000` | Default cooldown period |

See `.env.example` for the complete list.
