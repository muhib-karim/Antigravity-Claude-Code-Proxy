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

### 9. "This version of Antigravity is no longer supported. Please update/upgrade to receive the latest features!"

**Symptoms:**
- Every Gemini and Claude request fails with that text (some Antigravity clients show it as the model's reply)
- The proxy answers `400 invalid_request_error` with a message like
  `Antigravity rejected this proxy's client version (antigravity/2.5.5) ... Set ANTIGRAVITY_VERSION ...`
- The log shows the same hint once

**Cause:**
Google's Cloud Code backend rejects old Antigravity client versions, judged by the version in the
`User-Agent` the proxy sends (`antigravity/<version> <os>/<arch>`). Proxy releases before this fix sent
`antigravity/1.11.5`, which is no longer accepted.

**Solutions:**

1. Update the proxy (the default is now `2.5.5`, the stable Antigravity IDE release at the time of the fix).
2. If Google has moved on again, set the version of your installed Antigravity IDE (Help > About) in `.env`
   and restart the proxy:
   ```env
   ANTIGRAVITY_VERSION=2.6.0
   ```
   The value must be dotted numeric `x.y.z`; anything else is ignored with a warning at startup.

---

### 10. Perplexity model returns `{"type":"error","error":{"type":"api_error","message":"fetch failed"}}`

**Symptoms:**
- `perplexity-*` / `pplx-*` models (for example `pplx-grok`) fail, Gemini and Claude models work
- Older versions answered HTTP 500 `fetch failed`; the log shows
  `[API] Forwarding to Python server: http://localhost:8000/v1/chat/completions` followed by
  `TypeError: fetch failed ... ECONNREFUSED`
- Current versions answer HTTP 503 `api_error`:
  `Perplexity backend is not reachable at http://localhost:8000 (ECONNREFUSED). ...`

**Cause:**
Perplexity models are forwarded to a separate Perplexity backend server, which is not part of this
package. Nothing is listening at its address.

**Solutions:**

1. Start the Perplexity backend server, then retry.
2. If it runs elsewhere (another port, host or container), point the proxy at it and restart:
   ```env
   PERPLEXITY_SERVER_URL=http://127.0.0.1:8001
   ```
   It must be an `http://` or `https://` base URL; a path is allowed (`http://host:8001/base`), but
   credentials (`user:password@`), a query string or a fragment are not. Such a value is ignored with a
   warning at startup (the rejected value is not shown) and the default `http://localhost:8000` is used.
3. Check that it answers: `curl http://localhost:8000/stats` (or `GET /perplexity-stats` on the proxy).
4. If you do not use Perplexity, pick a Gemini or Claude model; they do not need this server.

HTTP errors from the backend are mapped like other upstream errors (`src/http/error-mapper.js`), and a
`retry-after` from the backend is passed on where shown:

| Backend status | Client gets |
|---|---|
| 429 | `400 invalid_request_error` by default, or `429 rate_limit_error` with `RATE_LIMIT_STATUS=429` (both with `retry-after`) |
| 400 | `400 invalid_request_error` |
| 401 | `401 authentication_error` |
| 403 | `403 permission_error` |
| 404 | `404 not_found_error` |
| 413 | `413 request_too_large` |
| other 4xx | the same status, `invalid_request_error` |
| 503, 529 | `529 overloaded_error` (with `retry-after`) |
| other 5xx | `502 api_error` |

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
| `ANTIGRAVITY_VERSION` | `2.5.5` | Antigravity client version in the User-Agent (see issue 9) |
| `PERPLEXITY_SERVER_URL` | `http://localhost:8000` | Perplexity backend base URL (see issue 10) |

See `.env.example` for the complete list.
