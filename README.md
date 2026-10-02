<p align="center">
  <img src="docs/images/banner.png" alt="Antigravity Proxy Banner" width="100%" style="border-radius: 10px;">
</p>

<p align="center">
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy"><img src="https://img.shields.io/badge/Proxy-v2.10.0-blue?style=for-the-badge" alt="Proxy v2.10.0"></a>
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/muhib-karim/Antigravity-Claude-Code-Proxy/ci.yml?branch=main&label=CI&style=for-the-badge" alt="CI"></a>
  <a href="https://open-vsx.org/extension/ai-dev-2024/claude-proxy-status"><img src="https://img.shields.io/badge/Extension-v4.3.0-purple?style=for-the-badge" alt="Extension v4.3.0"></a>
  <img src="https://img.shields.io/badge/Claude_Code-Compatible-blueviolet?style=for-the-badge&logo=anthropic" alt="Claude Code Compatible">
  <img src="https://img.shields.io/badge/Antigravity-Powered-00D4AA?style=for-the-badge" alt="Antigravity Powered">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License">
  <a href="https://ko-fi.com/ai_dev_2024"><img src="https://img.shields.io/badge/Support%20Me-Ko--fi-red?style=for-the-badge&logo=ko-fi" alt="Support Me"></a>
  <a href="https://startup.z.ai/"><img src="https://img.shields.io/badge/Part%20of-ZAI%20Start--up%20Community-8b5cf6?style=for-the-badge" alt="ZAI Community"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-Tested-007ACC?style=flat-square&logo=visual-studio-code" alt="VS Code">
  <img src="https://img.shields.io/badge/Antigravity-Tested-00D4AA?style=flat-square" alt="Antigravity">
  <img src="https://img.shields.io/badge/Cursor-Tested-black?style=flat-square" alt="Cursor">
</p>

<p align="center">
  <a href="https://open-vsx.org/extension/ai-dev-2024/claude-proxy-status">
    <img src="https://img.shields.io/badge/Install%20Extension-Open%20VSX-brightgreen?style=for-the-badge&logo=visual-studio-code" alt="Install Extension">
  </a>
</p>

<h1 align="center">🚀 Antigravity Claude Code Proxy</h1>

<p align="center">
  Based on <a href="https://github.com/badrisnarayanan/antigravity-claude-proxy">antigravity-claude-proxy</a> by Badri Narayanan S (MIT License).
</p>

<p align="center">
  <strong>Use Claude Code CLI with Gemini, GPT-5, Grok, and 20+ AI models</strong>
  <br><br>
  <em>A production-ready multi-provider AI gateway with session management and failover,<br>
  real-time status bar integration, and beautiful monitoring dashboard</em>
</p>

<p align="center">
  <a href="#-what-is-this">What is this?</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-models">Models</a> •
  <a href="#-dashboard">Dashboard</a> •
  <a href="#-status-bar-extension-v39">Status Bar</a> •
  <a href="#-development--testing">Development</a>
</p>

---

## 📖 What is this?

**Antigravity Claude Proxy** is a local proxy server that enables **Claude Code CLI** to use multiple AI providers:

| Without Proxy | With Proxy |
|--------------|------------|
| Only Claude models | **20+ AI models** (Gemini, GPT-5, Grok, Claude, etc.) |
| Manual session handling | **Managed sessions with automatic failover** |
| No monitoring | **Real-time dashboard** |
| No status | **Status bar integration** |

### How it Works

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│                 │      │                      │      │                     │
│  Claude Code    │─────▶│  Antigravity Proxy   │─────▶│  Google AI (Gemini) │
│  CLI/Extension  │      │  localhost:8080      │      │  + Perplexity       │
│                 │      │                      │      │  + More providers   │
└─────────────────┘      └──────────────────────┘      └─────────────────────┘
```

---

## 🖼️ Showcase

<p align="center">
  <img src="docs/images/dashboard.png" alt="Dashboard" width="700">
  <br>
  <em>Real-time dashboard with session health and usage stats</em>
</p>

<p align="center">
  <img src="docs/images/quota-popup.png" alt="Quota Popup" width="600">
  <br>
  <em>Click status bar to see Claude & Gemini quotas with reset times</em>
</p>

<p align="center">
  <img src="docs/images/model-switcher.png" alt="Model Switcher" width="400">
  <br>
  <em>One-click model switching between Flash, Pro, Opus, Sonnet, and more</em>
</p>

<p align="center">
  <img src="docs/images/statusbar-icon.png" alt="Status Bar" width="300">
  <br>
  <em>Live model indicator in your IDE status bar (⚡ Flash, 💎 Pro, 🎭 Opus)</em>
</p>

---

## ✨ Features

### 🎯 Core Capabilities

| Feature | Description |
|---------|-------------|
| **Multi-Provider Access** | Use Gemini, GPT-5, Grok, Claude, Kimi, and more through one API |
| **Session Management** | Tracks signed-in sessions, keeps requests on a stable session and fails over when one is unavailable |
| **Status Bar Integration** | See current model with emoji icons (⚡💎🎭🎵) |
| **Beautiful Dashboard** | Monitor accounts, usage, and switch models at `localhost:8080` |
| **Auto-Start** | Proxy starts when extension is enabled (opt-in) |
| **Model Persistence** | Your selected model survives restarts |

### 🧠 Smart Features

- **🔄 Smart Routing**: Extension dropdown Opus/Haiku/Default pass-through, Custom uses dashboard
- **⚡ Agentic Fallback**: Chat-only models auto-switch to agentic models for file operations
- **📊 Usage Tracking**: Per-model and per-account statistics
- **🛡️ Reliability**: Retries with backoff and routes around unavailable sessions

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (CI runs the tests on Node 20 and 22)
- **PM2** (optional process manager) - `npm install -g pm2`
- **Antigravity** desktop app ([Download](https://antigravity.dev)) or VS Code
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code`)

### Installation

```bash
# Clone the repository
git clone https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy.git
cd Antigravity-Claude-Code-Proxy/Antigravity-Claude-Code-Proxy

# Install dependencies
npm install

# Start the proxy in the foreground...
npm start

# ...or as a persistent background service with PM2
pm2 start src/index.js --name antigravity-proxy
pm2 save
```

### Add an Account

Google sign-in needs an OAuth client secret, which is not stored in this repository. Set it first, in your shell or in a `.env` file next to `package.json` (copy `.env.example`, which lists every setting):

```bash
export GOOGLE_OAUTH_CLIENT_SECRET="<your OAuth client secret>"
# optional, if you use your own OAuth app:
export GOOGLE_OAUTH_CLIENT_ID="<your OAuth client id>"
```

```bash
npm run accounts:add     # opens a Google sign-in in your browser (needs a desktop browser)
npm run accounts:list    # show configured accounts
```

If no account is configured, the proxy still starts and `/health` answers, but `/v1/messages` returns a clear "No accounts available" error.

### Configure Environment

**Windows (PowerShell, not verified on Linux CI):**
```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:8080", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "antigravity-proxy", "User")
```

**macOS/Linux:**
```bash
echo 'export ANTHROPIC_BASE_URL="http://localhost:8080"' >> ~/.bashrc
echo 'export ANTHROPIC_API_KEY="antigravity-proxy"' >> ~/.bashrc
source ~/.bashrc
```

### Auto-Start on Windows Login (Optional)

> **Note:** By default, the proxy only starts when you open Antigravity with the extension enabled. For system-wide startup on Windows login, run (Windows-only batch scripts; not verified on Linux):

```batch
cd scripts\setup
SETUP_STARTUP.bat
```

This will:
- Register the proxy with PM2
- Create a Windows startup script
- Proxy starts automatically on Windows login

### Start Using!

```bash
claude
```

> **Note:** The proxy runs in the background via PM2. You can close any terminal or IDE window without affecting it. To check status: `pm2 list`. To stop: `pm2 stop antigravity-proxy`.

---

## 🤖 Models

### ⚡ Agentic Models (Full Capabilities)

| Model | Alias | Best For |
|-------|-------|----------|
| `gemini-3-flash` | `flash` | Fast tasks, simple commands |
| `gemini-3-pro-high` | `pro` | Complex coding, deep analysis |
| `claude-opus-4-5-thinking` | `claude-opus` | Complex reasoning |
| `claude-sonnet-4-5-thinking` | `claude-sonnet` | Balanced performance |

> The short aliases `opus` and `sonnet` map to the Perplexity models `pplx-claude-opus` / `pplx-claude-sonnet`, which are chat-only (no tool use).

### 🔍 Search Models (Chat + Web Search)

| Model | Provider | Description |
|-------|----------|-------------|
| `pplx-grok` | Perplexity | Grok 4.1 with web search |
| `pplx-gpt51` | Perplexity | GPT-5.1 chat |
| `pplx-kimi` | Perplexity | Kimi (Moonshot) |
| `sonar` | Perplexity | Web search focused |

### Model Switching

```bash
# In Claude Code chat:
/model flash        # Switch to Gemini 3 Flash
/model pro          # Switch to Gemini 3 Pro
/model grok         # Switch to Grok (Perplexity)

# Or use dashboard:
# Open http://localhost:8080/dashboard
```

---

## 📊 Dashboard

Access the dashboard at **http://localhost:8080/dashboard**

Features:
- **Account Monitor**: See all accounts, their status, and remaining quota
- **Model Switcher**: Quick dropdown to change active model
- **Usage Statistics**: Track requests per model
- **Health Status**: See which sessions are healthy or need attention

---

## 📊 Status Bar Extension (v3.9+)

The status bar extension shows your current model and quota information in real-time:

### Status Bar Icons

| Icon | Model |
|------|-------|
| ⚡ | Gemini Flash |
| 💎 | Gemini Pro |
| 🎭 | Claude Opus |
| 🎵 | Claude Sonnet |
| 🌐 | Grok |
| 🔍 | Perplexity/Sonar |

### Quota Popup (Click Account Icon)

- **Model Quotas**: Overall Claude & Gemini percentages with visual bars
- **Per-Account Breakdown**: All connected accounts with individual quotas
- **Smart Sorting**: Accounts with highest Claude quota shown first
- **Reset Times**: Know exactly when your quota resets

### Features

- **One-Click Model Switching**: Click model name to switch instantly
- **Real-Time Updates**: 5-second polling for accurate quota display
- **Offline Detection**: Shows "Offline" in red when proxy is down
- **Open Dashboard**: Quick link to full web dashboard

---

## 🔌 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | POST | Anthropic Messages API |
| `/v1/models` | GET | List available models |
| `/active-model` | GET/POST/DELETE | Model override control |
| `/session-model` | POST | Per-session model |
| `/dashboard` | GET | Web dashboard |
| `/health` | GET | Health check |
| `/account-limits` | GET | Account quotas |

---

## 📁 Project Structure

```
Antigravity-Claude-Code-Proxy/
├── Antigravity-Claude-Code-Proxy/   # The proxy package (run npm commands here)
│   ├── src/
│   │   ├── index.js           # Entry point (starts the HTTP server)
│   │   ├── server.js          # Express app and routes
│   │   ├── cloudcode-client.js# Upstream Cloud Code client with retries/failover
│   │   ├── account-manager.js # Multi-account handling
│   │   ├── format/            # Anthropic <-> Google format converters
│   │   ├── constants.js       # Model aliases & config
│   │   └── public/
│   │       └── dashboard.html # Web dashboard
│   ├── tests/
│   │   ├── smoke/             # Offline tests run by `npm test`
│   │   └── *.cjs              # Live tests run by `npm run test:live`
│   └── package.json           # v4.1.0
├── scripts/                   # Windows setup/startup helpers (.bat/.ps1)
├── docs/
│   └── images/                # Showcase images
├── SECURITY.md                # Security policy
└── CHANGELOG.md               # Version history
```

---

## 🧪 Development & Testing

Run these from the package folder. They are the same steps CI runs ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

```bash
cd Antigravity-Claude-Code-Proxy/Antigravity-Claude-Code-Proxy

# Install exact dependencies from the lockfile.
# PUPPETEER_SKIP_DOWNLOAD=true skips the Chromium download, which is only needed for Perplexity browser login.
PUPPETEER_SKIP_DOWNLOAD=true npm ci

# Lint (errors fail the build; warnings are reported)
npm run lint

# Offline test suite (no accounts, keys or network needed)
npm test

# Run the proxy in the foreground, then check it from another terminal
npm start
curl http://localhost:8080/health
```

`npm test` uses Node's built-in test runner. It starts the real proxy on a free port with a temporary home folder and points it at a mock Cloud Code server. It covers `/health`, `/v1/models`, streaming and non-streaming `/v1/messages`, tool calls, per-session models, the no-account error path, the model-switch endpoints, cross-origin blocking, account-file persistence, and the request/response format converters.

The older end-to-end scripts talk to real models, so they need a running proxy with at least one configured account and are not part of `npm test`:

```bash
npm start            # terminal 1
npm run test:live    # terminal 2
```

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Only use `0.0.0.0` if you really want other machines to reach the proxy; it has no authentication |
| `ACCOUNT_CONFIG_PATH` | `~/.config/antigravity-proxy/accounts.json` | Google account store |
| `PROXY_STATE_DIR` | package folder | Where `logs/`, `model-override.json` and `session-models.json` are written |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Extra comma-separated browser origins allowed to call the proxy (localhost and editor webviews are always allowed). If you set `HOST=0.0.0.0` and open the dashboard via another address, add that address here, e.g. `http://192.168.1.10:8080` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | *(none; required for Google sign-in and token refresh)* | OAuth client secret. Not stored in the repository |
| `GOOGLE_OAUTH_CLIENT_ID` | built-in client id | OAuth client id, for your own OAuth app |
| `CLOUDCODE_ENDPOINTS` | Google Cloud Code endpoints | Comma-separated upstream override (the tests point this at a mock server) |

> Perplexity browser login needs the optional browser packages: `npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth`. Without them the proxy runs normally and only that feature reports an install hint.
>
> Perplexity models are served through a separate Python server on `localhost:8000` that is not part of this repository, so they are not covered by the tests.

---

## 🔒 Security

- **No credentials in code**: the OAuth client secret comes from `GOOGLE_OAUTH_CLIENT_SECRET` (older revisions embedded it; it is no longer in the source). All sensitive data stored locally; account files are written with owner-only permissions (`0600`)
- **Comprehensive .gitignore**: Accounts, tokens, logs excluded
- **Local-only**: Binds to `127.0.0.1` by default. Requests from other websites (foreign `Origin` headers) and, while bound to loopback, requests with a non-local `Host` header (DNS rebinding) are refused
- **npm audit clean**: the headless-browser stack (Puppeteer) is an optional peer dependency used only by Perplexity browser login, so the default install has no known advisories. CI runs `npm audit` and a full-history gitleaks scan on every push
- **Secrets**: `.env.example` lists every setting; `.env` is git-ignored. A Google OAuth client secret that the upstream project publishes appeared in early history and is allow-listed in `.gitleaksignore`; it is no longer in the source

See [SECURITY.md](SECURITY.md) for full security policy.

---

## 📋 Version History

| Version | Type | Features |
|---------|------|----------|
| **v2.10** | Extension v4.3.0 | **Offline tests + CI**, security hardening, optional browser stack, `npm audit` clean |
| **v2.9** | Extension v4.3.0 | **Opt-in auto-start**, proxy disabled by default |
| **v2.7** | Extension v4.1.1 | Per-window model selection, workspace persistence |
| **v2.6** | Extension | Per-session isolation, sessions dashboard |
| **v2.5** | Extension | IDE account switcher, simplified layout |
| **v2.4** | Extension | Direct OAuth, multi-state auth server |
| **v2.3** | Extension | Per-window models, dark theme dashboard |
| **v2.2** | Extension | PM2 process manager, Material Design |
| **v2.1** | Extension | Robust model routing, faster polling |
| **v2.0** | Extension | Status bar extension, model mapping |
| **v1.2** | CLI | Smart routing, model persistence |
| **v1.1** | CLI | Multi-account, Perplexity, dashboard |
| **v1.0** | CLI | Initial release |

See [CHANGELOG.md](CHANGELOG.md) for detailed history.

---

## 📜 License

MIT License - See [LICENSE](LICENSE) for details.

This project is built on [antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy) by Badri Narayanan S, used under the MIT License. The original copyright notice is kept in [LICENSE](LICENSE).

---

<p align="center">
  <strong>Made with ❤️ for the Claude Code community</strong>
  <br>
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/issues">Report Bug</a> •
  <a href="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy/issues">Request Feature</a>
</p>

<br>

<h2 align="center">❤️ Support This Project</h2>

<p align="center">
  If you find this project helpful, please consider buying me a coffee! Your support helps keep the updates coming.
</p>

<p align="center">
  <a href="https://ko-fi.com/ai_dev_2024">
    <img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Buy Me A Coffee" height="50">
  </a>
</p>