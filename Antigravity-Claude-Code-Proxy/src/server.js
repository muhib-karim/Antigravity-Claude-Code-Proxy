/**
 * Express Server - Anthropic-compatible API
 * Proxies to Google Cloud Code via Antigravity
 * Supports multi-account load balancing
 */

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendMessage, sendMessageStream, listModels, getModelQuotas } from './cloudcode-client.js';
import { PerplexityClient } from './perplexity-client.js';
import { PerplexityAccountManager } from './perplexity-account-manager.js';
import { PerplexitySessionClient } from './perplexity-session-client.js';
import { PerplexitySessionAccountManager } from './perplexity-session-account-manager.js';
import { getLoginService } from './perplexity-browser-login.js';
import { getPerplexityBrowserClient } from './perplexity-browser-client.js';
import { forceRefresh } from './token-extractor.js';
import { REQUEST_BODY_LIMIT, DEFAULT_HOST, resolveModelAlias } from './constants.js';
import { AccountManager } from './account-manager.js';
import { formatDuration } from './utils/helpers.js';
import fs from 'fs';
import { homedir } from 'os';

// ================= FILE LOGGING SYSTEM =================
const __dirname = dirname(fileURLToPath(import.meta.url));
// Directory for runtime state (logs, model override, session models). Defaults to the package root.
const STATE_DIR = process.env.PROXY_STATE_DIR || join(__dirname, '..');
const LOG_DIR = join(STATE_DIR, 'logs');
const LOG_FILE = join(LOG_DIR, 'proxy.log');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logLine);
    console.log(message); // Also log to console
}

function logRequest(type, model, source = 'unknown', durationMs = null) {
    const duration = durationMs ? ` (${durationMs}ms)` : '';
    logToFile(`[${type}] Model: ${model} | Source: ${source}${duration}`);
}

const app = express();
const accountManager = new AccountManager();
const perplexityAccountManager = new PerplexityAccountManager();
const perplexityClient = new PerplexityClient(perplexityAccountManager);
// Perplexity Session-based client (uses subscription instead of API keys)
const perplexitySessionManager = new PerplexitySessionAccountManager();
const perplexitySessionClient = new PerplexitySessionClient(perplexitySessionManager);
let isInitialized = false;
let initPromise = null;

// Per-model usage tracking (in-memory, resets on server restart)
const modelUsageTracker = {
    google: {},      // { modelId: count }
    perplexity: {},  // { modelId: count }
    lastReset: new Date().toISOString()
};

function trackModelUsage(provider, modelId) {
    const tracker = provider === 'perplexity' ? modelUsageTracker.perplexity : modelUsageTracker.google;
    tracker[modelId] = (tracker[modelId] || 0) + 1;
}

function getModelUsageStats() {
    return {
        google: { ...modelUsageTracker.google },
        perplexity: { ...modelUsageTracker.perplexity },
        lastReset: modelUsageTracker.lastReset,
        totalGoogle: Object.values(modelUsageTracker.google).reduce((a, b) => a + b, 0),
        totalPerplexity: Object.values(modelUsageTracker.perplexity).reduce((a, b) => a + b, 0)
    };
}

// ================= GLOBAL MODEL OVERRIDE =================
// Allows switching model for ALL requests via dashboard
// This enables model switching for VS Code extension
let globalModelOverride = null; // null = use request's model, string = override all requests
let lastExtensionModel = null; // Track last model extension sent to detect user changes

// Paths for persistence and syncing
// Per-user editor config dir: %APPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config elsewhere
const USER_HOME = process.env.USERPROFILE || process.env.HOME || homedir();
const EDITOR_CONFIG_DIR = process.env.APPDATA || (process.platform === 'darwin'
    ? join(USER_HOME, 'Library', 'Application Support')
    : join(USER_HOME, '.config'));
const ANTIGRAVITY_SETTINGS = join(EDITOR_CONFIG_DIR, 'Antigravity', 'User', 'settings.json');
const VSCODE_SETTINGS = join(EDITOR_CONFIG_DIR, 'Code', 'User', 'settings.json');
const CLAUDE_CODE_SETTINGS = join(USER_HOME, '.claude', 'settings.json');
const MODEL_OVERRIDE_FILE = join(STATE_DIR, 'model-override.json');

// Load persisted model override on startup
// First tries model-override.json, then falls back to ~/.claude/settings.json
function loadPersistedModelOverride() {
    // First, try to load from model-override.json (proxy's own persistence)
    try {
        if (fs.existsSync(MODEL_OVERRIDE_FILE)) {
            const data = JSON.parse(fs.readFileSync(MODEL_OVERRIDE_FILE, 'utf-8'));
            if (data.model) {
                globalModelOverride = data.model;
                console.log(`[ModelSwitch] Loaded persisted model from proxy: ${data.model}`);
                return data.model;
            }
        }
    } catch (err) {
        console.log(`[ModelSwitch] Could not load from model-override.json: ${err.message}`);
    }

    // Second, try to load from ~/.claude/settings.json (Claude Code CLI settings)
    try {
        if (fs.existsSync(CLAUDE_CODE_SETTINGS)) {
            const data = JSON.parse(fs.readFileSync(CLAUDE_CODE_SETTINGS, 'utf-8'));
            if (data.model) {
                globalModelOverride = data.model;
                console.log(`[ModelSwitch] Loaded model from Claude settings: ${data.model}`);
                // Also persist to our file for consistency
                persistModelOverride(data.model);
                return data.model;
            }
            // Also check env.ANTHROPIC_MODEL
            if (data.env && data.env.ANTHROPIC_MODEL) {
                globalModelOverride = data.env.ANTHROPIC_MODEL;
                console.log(`[ModelSwitch] Loaded model from ANTHROPIC_MODEL env: ${data.env.ANTHROPIC_MODEL}`);
                persistModelOverride(data.env.ANTHROPIC_MODEL);
                return data.env.ANTHROPIC_MODEL;
            }
        }
    } catch (err) {
        console.log(`[ModelSwitch] Could not load from Claude settings: ${err.message}`);
    }

    return null;
}

// Save model override to file
function persistModelOverride(model) {
    try {
        fs.writeFileSync(MODEL_OVERRIDE_FILE, JSON.stringify({ model, timestamp: new Date().toISOString() }), 'utf-8');
        console.log(`[ModelSwitch] Persisted model: ${model}`);
    } catch (err) {
        console.log(`[ModelSwitch] Could not persist model: ${err.message}`);
    }
}

// Load on module init and sync to settings.json
const loadedModel = loadPersistedModelOverride();
if (loadedModel) {
    // Sync to settings.json on startup so extension shows correct model
    syncModelToSettings(loadedModel);
    console.log(`[ModelSwitch] Startup sync: ${loadedModel} → settings.json`);
}

function getActiveModel() {
    return globalModelOverride || 'gemini-3-flash';
}

function setActiveModel(model) {
    const resolved = resolveModelAlias(model);
    globalModelOverride = resolved;
    console.log(`[ModelSwitch] Global model set to: ${resolved}`);

    // Persist to file so it survives restarts
    persistModelOverride(resolved);

    // Sync to settings.json files so extension UI updates
    syncModelToSettings(resolved);

    return resolved;
}

// Model ids are short identifiers; anything else must never be spliced into settings files.
// (A function declaration, so it is usable by the startup sync that runs above this point.)
function isValidModelName(model) {
    return typeof model === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(model);
}

function syncModelToSettings(model) {
    if (!isValidModelName(model)) {
        console.warn('[ModelSync] Refusing to write invalid model name to settings files');
        return;
    }
    const filesToUpdate = [ANTIGRAVITY_SETTINGS, VSCODE_SETTINGS];

    for (const settingsPath of filesToUpdate) {
        try {
            if (fs.existsSync(settingsPath)) {
                let content = fs.readFileSync(settingsPath, 'utf-8');
                let updated = false;

                // Update claudeCode.selectedModel
                const regex = /"claudeCode\.selectedModel"\s*:\s*"[^"]*"/;
                if (regex.test(content)) {
                    content = content.replace(regex, () => `"claudeCode.selectedModel": ${JSON.stringify(model)}`);
                    updated = true;
                }

                // Also update ANTHROPIC_MODEL in environmentVariables
                // This pattern matches: {"name": "ANTHROPIC_MODEL", "value": "..."}
                const envModelRegex = /("name"\s*:\s*"ANTHROPIC_MODEL"\s*,\s*"value"\s*:\s*)"[^"]*"/;
                if (envModelRegex.test(content)) {
                    content = content.replace(envModelRegex, (_match, prefix) => `${prefix}${JSON.stringify(model)}`);
                    updated = true;
                    console.log(`[ModelSync] Updated ANTHROPIC_MODEL env var to: ${model}`);
                }

                if (updated) {
                    fs.writeFileSync(settingsPath, content, 'utf-8');
                    console.log(`[ModelSync] Updated ${settingsPath.includes('Antigravity') ? 'Antigravity' : 'VS Code'} settings.json`);
                }
            }
        } catch (err) {
            console.log(`[ModelSync] Could not update ${settingsPath}: ${err.message}`);
        }
    }

    // CRITICAL: Update Claude Code CLI settings (~/.claude/settings.json)
    // This is where the Claude Code CLI reads its active model from!
    // Format: { "model": "...", "env": { "ANTHROPIC_MODEL": "..." } }
    try {
        if (fs.existsSync(CLAUDE_CODE_SETTINGS)) {
            const data = JSON.parse(fs.readFileSync(CLAUDE_CODE_SETTINGS, 'utf-8'));
            let updated = false;

            // Update top-level "model" key - THIS IS WHAT THE DROPDOWN READS
            if (data.model !== model) {
                data.model = model;
                updated = true;
            }

            // Update env.ANTHROPIC_MODEL
            if (data.env && data.env.ANTHROPIC_MODEL !== model) {
                data.env.ANTHROPIC_MODEL = model;
                updated = true;
            }

            if (updated) {
                fs.writeFileSync(CLAUDE_CODE_SETTINGS, JSON.stringify(data, null, 2), 'utf-8');
                console.log(`[ModelSync] Updated Claude Code CLI settings.json: model=${model}`);
            }
        }
    } catch (err) {
        console.log(`[ModelSync] Could not update Claude Code settings: ${err.message}`);
    }
}

function clearModelOverride() {
    globalModelOverride = null;
    // Remove persisted file
    try {
        if (fs.existsSync(MODEL_OVERRIDE_FILE)) {
            fs.unlinkSync(MODEL_OVERRIDE_FILE);
        }
    } catch (err) { }
    console.log('[ModelSwitch] Global model override cleared - using request models');
}

// ================= PER-SESSION MODEL STORE =================
// Allows each Antigravity window or CLI terminal to have its own model
// Sessions persist to disk and survive proxy restarts

const SESSION_MODELS_FILE = join(STATE_DIR, 'session-models.json');
const sessionModels = new Map(); // sessionId -> { model, lastUsed, name }

// Load persisted sessions on startup
function loadSessionModels() {
    try {
        if (fs.existsSync(SESSION_MODELS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSION_MODELS_FILE, 'utf-8'));
            for (const [sessionId, info] of Object.entries(data.sessions || {})) {
                sessionModels.set(sessionId, info);
            }
            console.log(`[SessionStore] Loaded ${sessionModels.size} sessions from disk`);
        }
    } catch (err) {
        console.log(`[SessionStore] Could not load sessions: ${err.message}`);
    }
}

// Save sessions to disk
function persistSessionModels() {
    try {
        const data = {
            sessions: Object.fromEntries(sessionModels),
            lastSaved: new Date().toISOString()
        };
        fs.writeFileSync(SESSION_MODELS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.log(`[SessionStore] Could not persist sessions: ${err.message}`);
    }
}

// Get model for a session (falls back to global model if session not found)
function getSessionModel(sessionId) {
    if (!sessionId) return getActiveModel();

    const session = sessionModels.get(sessionId);
    if (session) {
        // Update last used time
        session.lastUsed = new Date().toISOString();
        return session.model;
    }

    // Session not found, return global model
    return getActiveModel();
}

// Set model for a session
function setSessionModel(sessionId, model, name = null) {
    if (!sessionId) {
        // No session ID = set global model (backward compatible)
        return setActiveModel(model);
    }

    const resolved = resolveModelAlias(model);
    sessionModels.set(sessionId, {
        model: resolved,
        name: name || sessionId.slice(0, 8),
        lastUsed: new Date().toISOString(),
        createdAt: sessionModels.get(sessionId)?.createdAt || new Date().toISOString()
    });

    console.log(`[SessionStore] Session ${sessionId.slice(0, 8)} model set to: ${resolved}`);
    persistSessionModels();

    return resolved;
}

// Get all sessions
function getAllSessions() {
    return Array.from(sessionModels.entries()).map(([id, info]) => ({
        sessionId: id,
        ...info
    }));
}

// Delete a session
function deleteSession(sessionId) {
    if (sessionModels.has(sessionId)) {
        sessionModels.delete(sessionId);
        persistSessionModels();
        console.log(`[SessionStore] Deleted session ${sessionId.slice(0, 8)}`);
        return true;
    }
    return false;
}

// Load sessions on module init
loadSessionModels();

async function ensureInitialized() {
    if (isInitialized) return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        try {
            await accountManager.initialize();
            await perplexityAccountManager.initialize();
            await perplexitySessionManager.initialize();
            isInitialized = true;
            console.log(`[Server] Account pool initialized: ${accountManager.getStatus().summary}`);
            if (perplexitySessionManager.hasAccounts()) {
                console.log(`[Server] Perplexity session accounts loaded: ${perplexitySessionManager.getAccounts().length}`);
            }
        } catch (error) {
            initPromise = null;
            console.error('[Server] Init failed:', error);
            throw error;
        }
    })();
    return initPromise;
}

// Middleware
// Browsers attach an Origin header to cross-site requests. Only local pages (the dashboard,
// editor webviews) and extra origins listed in CORS_ALLOWED_ORIGINS may use the proxy that way,
// so a random website cannot drive the account/model/restart endpoints. CLI clients send no Origin.
const LOCAL_ORIGIN_PATTERN = /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|vscode-webview:\/\/[^\s]+|vscode-file:\/\/[^\s]+)$/i;
const EXTRA_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);

function isAllowedOrigin(origin) {
    return !origin || LOCAL_ORIGIN_PATTERN.test(origin) || EXTRA_ALLOWED_ORIGINS.includes(origin);
}

// While bound to loopback, also require a local Host header. This stops DNS-rebinding pages
// (which send no Origin on same-origin GETs) from reading account and session data.
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const ENFORCE_LOCAL_HOST = ['127.0.0.1', 'localhost', '::1'].includes(DEFAULT_HOST);
const EXTRA_ALLOWED_HOSTS = EXTRA_ALLOWED_ORIGINS.map(o => o.replace(/^[a-z-]+:\/\//i, '').replace(/\/.*$/, ''));

function isAllowedHost(host) {
    return !ENFORCE_LOCAL_HOST || !host || LOCAL_HOST_PATTERN.test(host) || EXTRA_ALLOWED_HOSTS.includes(host);
}

app.use((req, res, next) => {
    if (!isAllowedHost(req.headers.host)) {
        return res.status(403).json({
            type: 'error',
            error: { type: 'permission_error', message: 'Requests must use localhost or 127.0.0.1 as the host' }
        });
    }
    if (!isAllowedOrigin(req.headers.origin)) {
        return res.status(403).json({
            type: 'error',
            error: { type: 'permission_error', message: 'Cross-origin requests from this origin are not allowed' }
        });
    }
    next();
});
app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// Serve static files (dashboard)
// __dirname already defined in logging section above
app.use(express.static(join(__dirname, 'public')));

// Dashboard redirect
app.get('/dashboard', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// Restart endpoint - restarts the proxy server
app.post('/restart', (req, res) => {
    console.log('[Server] Restart requested via dashboard');
    res.json({ status: 'restarting', message: 'Proxy will restart in 2 seconds...' });

    // Graceful restart after response is sent
    setTimeout(() => {
        console.log('[Server] Restarting...');
        process.exit(0); // Exit cleanly - the startup script (VBS) or npm will restart
    }, 2000);
});

// ================= MODEL SWITCHING ENDPOINTS =================
// These enable model switching from the dashboard for VS Code extension

// Get current active model
app.get('/active-model', (req, res) => {
    res.json({
        model: getActiveModel(),
        isOverride: globalModelOverride !== null,
        message: globalModelOverride
            ? `All requests using: ${globalModelOverride}`
            : 'Using model from each request'
    });
});

// Set active model (global override)
app.post('/active-model', (req, res) => {
    const { model } = req.body;
    if (!model) {
        return res.status(400).json({ error: 'model is required' });
    }
    if (!isValidModelName(model)) {
        return res.status(400).json({ error: 'invalid model name' });
    }
    const resolved = setActiveModel(model);
    res.json({
        success: true,
        model: resolved,
        message: `All requests will now use: ${resolved}`
    });
});

// Clear model override (use request's model)
app.delete('/active-model', (req, res) => {
    clearModelOverride();
    res.json({
        success: true,
        message: 'Model override cleared - using model from each request'
    });
});

// ================= SESSION MODEL ENDPOINTS =================
// Per-window/terminal model isolation

// Get model for a specific session
app.get('/session-model/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessionModels.get(sessionId);

    if (session) {
        res.json({
            sessionId,
            model: session.model,
            name: session.name,
            lastUsed: session.lastUsed,
            createdAt: session.createdAt
        });
    } else {
        res.json({
            sessionId,
            model: getActiveModel(),
            isDefault: true,
            message: 'Session not found, using global model'
        });
    }
});

// Set model for a session
app.post('/session-model', (req, res) => {
    const { sessionId, model, name } = req.body;
    if (!model) {
        return res.status(400).json({ error: 'model is required' });
    }
    if (!isValidModelName(model)) {
        return res.status(400).json({ error: 'invalid model name' });
    }
    if (sessionId != null && typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'sessionId must be a string' });
    }

    const resolved = setSessionModel(sessionId, model, name);
    res.json({
        success: true,
        sessionId: sessionId || 'global',
        model: resolved,
        message: sessionId
            ? `Session ${sessionId.slice(0, 8)} model set to: ${resolved}`
            : `Global model set to: ${resolved}`
    });
});

// Get all sessions
app.get('/sessions', (req, res) => {
    res.json({
        sessions: getAllSessions(),
        globalModel: getActiveModel(),
        count: sessionModels.size
    });
});

// Delete a session
app.delete('/session-model/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const deleted = deleteSession(sessionId);

    res.json({
        success: deleted,
        message: deleted
            ? `Session ${sessionId.slice(0, 8)} deleted`
            : 'Session not found'
    });
});

app.get('/perplexity-sessions', async (req, res) => {
    try {
        await ensureInitialized();
        const accounts = perplexitySessionManager.getAccounts();
        res.json({ accounts, count: accounts.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/perplexity-sessions', async (req, res) => {
    try {
        await ensureInitialized();
        const { email, sessionToken } = req.body;

        if (!email || !sessionToken) {
            return res.status(400).json({ error: 'email and sessionToken are required' });
        }

        await perplexitySessionManager.addAccount(email, sessionToken);
        res.json({ success: true, message: `Account ${email} added successfully` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/perplexity-sessions/:email', async (req, res) => {
    try {
        await ensureInitialized();
        const removed = await perplexitySessionManager.removeAccount(req.params.email);
        if (removed) {
            res.json({ success: true, message: `Account ${req.params.email} removed` });
        } else {
            res.status(404).json({ error: 'Account not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rename a Perplexity session account
app.patch('/perplexity-sessions/:email', async (req, res) => {
    try {
        await ensureInitialized();
        const { newName } = req.body;
        if (!newName) {
            return res.status(400).json({ error: 'newName is required' });
        }
        const renamed = await perplexitySessionManager.renameAccount(req.params.email, newName);
        if (renamed) {
            res.json({ success: true, message: `Account renamed to ${newName}` });
        } else {
            res.status(404).json({ error: 'Account not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove a Google account
app.delete('/google-accounts/:email', async (req, res) => {
    try {
        await ensureInitialized();
        const removed = await accountManager.removeAccount(req.params.email);
        if (removed) {
            res.json({ success: true, message: `Account ${req.params.email} removed` });
        } else {
            res.status(404).json({ error: 'Account not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================= OAUTH WEB ENDPOINTS =================
// Import OAuth functions for web-based authentication
import { getAuthorizationUrl, startCallbackServer, completeOAuthFlow, closeCallbackServer } from './oauth.js';

// Track multiple OAuth flows by state (enables back-to-back logins)
const oauthFlows = new Map();
const OAUTH_FLOW_TIMEOUT_MS = 180000; // 3 minutes - auto-cleanup stale flows

// Helper to cleanup stale OAuth flows
function cleanupStaleOAuthFlows() {
    const now = Date.now();
    for (const [state, flow] of oauthFlows) {
        if (now - flow.startedAt > OAUTH_FLOW_TIMEOUT_MS) {
            console.log(`[OAuth] Cleaning up stale flow ${state.slice(0, 8)}...`);
            oauthFlows.delete(state);
        }
    }
}

// Start OAuth flow - redirects to Google OAuth
app.get('/oauth/start', async (req, res) => {
    try {
        // Cleanup stale flows first
        cleanupStaleOAuthFlows();

        const { url, verifier, state } = getAuthorizationUrl();

        // Store this flow (allows multiple concurrent flows)
        oauthFlows.set(state, { verifier, startedAt: Date.now() });
        console.log(`[OAuth] Started flow ${state.slice(0, 8)}... (${oauthFlows.size} active)`);

        // Start callback server in background (will handle any registered state)
        startCallbackServer(state, 120000).then(async (code) => {
            // Find the flow by state
            const flow = oauthFlows.get(state);
            if (!flow) {
                console.log(`[OAuth] Flow ${state.slice(0, 8)}... already completed or cancelled`);
                return;
            }

            try {
                const accountInfo = await completeOAuthFlow(code, flow.verifier);
                console.log(`[OAuth] Successfully authenticated: ${accountInfo.email}`);

                // Add account to manager
                await accountManager.addAccount({
                    email: accountInfo.email,
                    refreshToken: accountInfo.refreshToken,
                    projectId: accountInfo.projectId,
                    source: 'oauth',
                    addedAt: new Date().toISOString()
                });

                console.log(`[OAuth] Account ${accountInfo.email} added successfully`);
            } catch (err) {
                console.error('[OAuth] Failed to complete flow:', err.message);
            } finally {
                oauthFlows.delete(state);
            }
        }).catch(err => {
            console.error('[OAuth] Callback error:', err.message);
            oauthFlows.delete(state);
        });

        // Redirect user to Google OAuth
        res.redirect(url);

    } catch (error) {
        console.error('[OAuth] Start error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Check OAuth status (also auto-cleans stale flows)
app.get('/oauth/status', (req, res) => {
    cleanupStaleOAuthFlows();
    res.json({
        inProgress: oauthFlows.size > 0,
        activeFlows: oauthFlows.size,
        startedAt: oauthFlows.size > 0 ? [...oauthFlows.values()][0]?.startedAt : null
    });
});

// Cancel all OAuth flows
app.delete('/oauth/cancel', (req, res) => {
    const count = oauthFlows.size;
    oauthFlows.clear();
    closeCallbackServer();
    res.json({ success: true, message: `Cancelled ${count} OAuth flow(s)` });
});

// Browser-based login for Perplexity - opens dedicated browser with stealth mode
app.post('/perplexity-login', async (req, res) => {
    try {
        await ensureInitialized();
        const loginService = getLoginService(perplexitySessionManager);

        if (loginService.isActive()) {
            return res.status(409).json({
                error: 'Login already in progress',
                message: 'Please complete the login in the browser window that opened'
            });
        }

        // Respond immediately that browser is opening
        res.json({
            status: 'started',
            message: 'Browser window opened. Please login to Perplexity - your session will be captured automatically.'
        });

        // Start login in background
        loginService.startLogin().then(result => {
            if (result.success) {
                console.log(`[Server] Perplexity login successful: ${result.email}`);
            } else {
                console.log(`[Server] Perplexity login: ${result.error}`);
            }
        }).catch(err => {
            console.error('[Server] Perplexity login error:', err.message);
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check login status
app.get('/perplexity-login/status', async (req, res) => {
    await ensureInitialized();
    const loginService = getLoginService(perplexitySessionManager);
    res.json({
        inProgress: loginService.isActive(),
        accounts: perplexitySessionManager.getAccounts().length
    });
});

/**
 * Model usage statistics endpoint
 * Returns per-model request counts for both Google and Perplexity
 */
app.get('/model-usage', (req, res) => {
    res.json(getModelUsageStats());
});

// Perplexity stats from Python server
app.get('/perplexity-stats', async (req, res) => {
    try {
        const pythonStats = await fetch('http://localhost:8000/stats');
        if (pythonStats.ok) {
            const stats = await pythonStats.json();
            res.json(stats);
        } else {
            res.json({ error: 'Python server not available', requests_today: 0 });
        }
    } catch (e) {
        res.json({ error: 'Python server not running', requests_today: 0 });
    }
});

/**
 * Parse error message to extract error type, status code, and user-friendly message
 */
function parseError(error) {
    let errorType = 'api_error';
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('401') || error.message.includes('UNAUTHENTICATED')) {
        errorType = 'authentication_error';
        statusCode = 401;
        errorMessage = 'Authentication failed. Make sure Antigravity is running with a valid token.';
    } else if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('QUOTA_EXHAUSTED')) {
        errorType = 'invalid_request_error';  // Use invalid_request_error to force client to purge/stop
        statusCode = 400;  // Use 400 to ensure client does not retry (429 and 529 trigger retries)

        // Try to extract the quota reset time from the error
        const resetMatch = error.message.match(/quota will reset after (\d+h\d+m\d+s|\d+m\d+s|\d+s)/i);
        const modelMatch = error.message.match(/"model":\s*"([^"]+)"/);
        const model = modelMatch ? modelMatch[1] : 'the model';

        if (resetMatch) {
            errorMessage = `You have exhausted your capacity on ${model}. Quota will reset after ${resetMatch[1]}.`;
        } else {
            errorMessage = `You have exhausted your capacity on ${model}. Please wait for your quota to reset.`;
        }
    } else if (error.message.includes('invalid_request_error') || error.message.includes('INVALID_ARGUMENT')) {
        errorType = 'invalid_request_error';
        statusCode = 400;
        const msgMatch = error.message.match(/"message":"([^"]+)"/);
        if (msgMatch) errorMessage = msgMatch[1];
    } else if (error.message.includes('All endpoints failed')) {
        errorType = 'api_error';
        statusCode = 503;
        errorMessage = 'Unable to connect to Claude API. Check that Antigravity is running.';
    } else if (error.message.includes('PERMISSION_DENIED')) {
        errorType = 'permission_error';
        statusCode = 403;
        errorMessage = 'Permission denied. Check your Antigravity license.';
    }

    return { errorType, statusCode, errorMessage };
}

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
    try {
        await ensureInitialized();
        const status = accountManager.getStatus();

        res.json({
            status: 'ok',
            accounts: status.summary,
            available: status.available,
            rateLimited: status.rateLimited,
            invalid: status.invalid,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Account limits endpoint - fetch quota/limits for all accounts × all models
 * Returns a table showing remaining quota and reset time for each combination
 * Use ?format=table for ASCII table output, default is JSON
 */
app.get('/account-limits', async (req, res) => {
    try {
        await ensureInitialized();
        const allAccounts = accountManager.getAllAccounts();
        const format = req.query.format || 'json';

        // Fetch quotas for each account in parallel
        const results = await Promise.allSettled(
            allAccounts.map(async (account) => {
                // Skip invalid accounts
                if (account.isInvalid) {
                    return {
                        email: account.email,
                        status: 'invalid',
                        error: account.invalidReason,
                        models: {}
                    };
                }

                try {
                    const token = await accountManager.getTokenForAccount(account);
                    const quotas = await getModelQuotas(token);

                    return {
                        email: account.email,
                        status: 'ok',
                        models: quotas
                    };
                } catch (error) {
                    return {
                        email: account.email,
                        status: 'error',
                        error: error.message,
                        models: {}
                    };
                }
            })
        );

        // Process results
        const accountLimits = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    email: allAccounts[index].email,
                    status: 'error',
                    error: result.reason?.message || 'Unknown error',
                    models: {}
                };
            }
        });

        // Collect all unique model IDs
        const allModelIds = new Set();
        for (const account of accountLimits) {
            for (const modelId of Object.keys(account.models || {})) {
                allModelIds.add(modelId);
            }
        }

        const sortedModels = Array.from(allModelIds).sort();

        // Return ASCII table format
        if (format === 'table') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');

            // Build table
            const lines = [];
            const timestamp = new Date().toLocaleString();
            lines.push(`Account Limits (${timestamp})`);

            // Get account status info
            const status = accountManager.getStatus();
            lines.push(`Accounts: ${status.total} total, ${status.available} available, ${status.rateLimited} rate-limited, ${status.invalid} invalid`);
            lines.push('');

            // Table 1: Account status
            const accColWidth = 25;
            const statusColWidth = 15;
            const lastUsedColWidth = 25;
            const resetColWidth = 25;

            let accHeader = 'Account'.padEnd(accColWidth) + 'Status'.padEnd(statusColWidth) + 'Last Used'.padEnd(lastUsedColWidth) + 'Quota Reset';
            lines.push(accHeader);
            lines.push('─'.repeat(accColWidth + statusColWidth + lastUsedColWidth + resetColWidth));

            for (const acc of status.accounts) {
                const shortEmail = acc.email.split('@')[0].slice(0, 22);
                const lastUsed = acc.lastUsed ? new Date(acc.lastUsed).toLocaleString() : 'never';

                // Get status and error from accountLimits
                const accLimit = accountLimits.find(a => a.email === acc.email);
                let accStatus;
                if (acc.isInvalid) {
                    accStatus = 'invalid';
                } else if (acc.isRateLimited) {
                    const remaining = acc.rateLimitResetTime ? acc.rateLimitResetTime - Date.now() : 0;
                    accStatus = remaining > 0 ? `limited (${formatDuration(remaining)})` : 'rate-limited';
                } else {
                    accStatus = accLimit?.status || 'ok';
                }

                // Get reset time from quota API
                const claudeModel = sortedModels.find(m => m.includes('claude'));
                const quota = claudeModel && accLimit?.models?.[claudeModel];
                const resetTime = quota?.resetTime
                    ? new Date(quota.resetTime).toLocaleString()
                    : '-';

                let row = shortEmail.padEnd(accColWidth) + accStatus.padEnd(statusColWidth) + lastUsed.padEnd(lastUsedColWidth) + resetTime;

                // Add error on next line if present
                if (accLimit?.error) {
                    lines.push(row);
                    lines.push('  └─ ' + accLimit.error);
                } else {
                    lines.push(row);
                }
            }
            lines.push('');

            // Calculate column widths
            const modelColWidth = Math.max(25, ...sortedModels.map(m => m.length)) + 2;
            const accountColWidth = 22;

            // Header row
            let header = 'Model'.padEnd(modelColWidth);
            for (const acc of accountLimits) {
                const shortEmail = acc.email.split('@')[0].slice(0, 18);
                header += shortEmail.padEnd(accountColWidth);
            }
            lines.push(header);
            lines.push('─'.repeat(modelColWidth + accountLimits.length * accountColWidth));

            // Data rows
            for (const modelId of sortedModels) {
                let row = modelId.padEnd(modelColWidth);
                for (const acc of accountLimits) {
                    const quota = acc.models?.[modelId];
                    let cell;
                    if (acc.status !== 'ok') {
                        cell = `[${acc.status}]`;
                    } else if (!quota) {
                        cell = '-';
                    } else if (quota.remainingFraction === null) {
                        cell = '0% (exhausted)';
                    } else {
                        const pct = Math.round(quota.remainingFraction * 100);
                        cell = `${pct}%`;
                    }
                    row += cell.padEnd(accountColWidth);
                }
                lines.push(row);
            }

            return res.send(lines.join('\n'));
        }

        // Default: JSON format
        const perplexityAccounts = perplexityAccountManager.getAccounts().map(acc => ({
            apiKey: '...' + acc.apiKey.slice(-5),
            addedAt: acc.addedAt,
            lastUsed: acc.lastUsed,
            isRateLimited: acc.isRateLimited,
            status: acc.isRateLimited ? 'rate-limited' : 'ok',
            usageCount: acc.usageCount || 0
        }));

        const responsePayload = {
            timestamp: new Date().toLocaleString(),
            totalAccounts: allAccounts.length,
            perplexityAccounts: perplexityAccounts,
            models: sortedModels,
            accounts: accountLimits.map(acc => {
                const originalAcc = allAccounts.find(a => a.email === acc.email);
                return {
                    email: acc.email,
                    status: acc.status,
                    error: acc.error || null,
                    lastUsed: originalAcc?.lastUsed || null,
                    limits: acc.models
                };
            })
        };

        res.json(responsePayload);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * Force token refresh endpoint
 */
app.post('/refresh-token', async (req, res) => {
    try {
        await ensureInitialized();
        // Clear all caches
        accountManager.clearTokenCache();
        accountManager.clearProjectCache();
        // Force refresh default token
        const token = await forceRefresh();
        res.json({
            status: 'ok',
            message: 'Token caches cleared and refreshed',
            tokenPrefix: token.substring(0, 10) + '...'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * List models endpoint (OpenAI-compatible format)
 * Includes Perplexity models when Perplexity accounts are configured
 * Returns the currently active model first with 'default' marker
 */
app.get('/v1/models', async (req, res) => {
    try {
        await ensureInitialized();

        let allModels = { data: [] };

        // Add the currently active model as the FIRST item (marked as default)
        const activeModel = getActiveModel();
        allModels.data.push({
            id: activeModel,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'antigravity-proxy',
            description: `🎯 Active Model: ${activeModel}`,
            is_default: true
        });

        // Get Google Cloud Code models if available
        // An upstream failure should not hide the active model or Perplexity models
        const account = accountManager.pickNext();
        if (account) {
            try {
                const token = await accountManager.getTokenForAccount(account);
                const googleModels = await listModels(token);
                if (googleModels && googleModels.data) {
                    // Filter out duplicates (if activeModel is already in the list)
                    const filteredModels = googleModels.data.filter(m => m.id !== activeModel);
                    allModels.data.push(...filteredModels);
                }
            } catch (err) {
                console.error('[API] Could not fetch Google models:', err.message);
            }
        }

        // Add Perplexity models if Perplexity accounts are configured
        if (perplexitySessionManager.hasAccounts()) {
            const pplxModels = await perplexitySessionClient.listModels();
            const pplxModelData = pplxModels.map(m => ({
                id: m.id,
                object: 'model',
                created: Date.now(),
                owned_by: 'perplexity',
                description: m.description
            })).filter(m => m.id !== activeModel);
            allModels.data.push(...pplxModelData);
        }

        if (allModels.data.length === 0) {
            return res.status(503).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: 'No accounts available. Add Google AI or Perplexity accounts via dashboard.'
                }
            });
        }

        res.json(allModels);
    } catch (error) {
        console.error('[API] Error listing models:', error);
        res.status(500).json({
            type: 'error',
            error: {
                type: 'api_error',
                message: error.message
            }
        });
    }
});

/**
 * Count tokens endpoint (not supported)
 */
app.post('/v1/messages/count_tokens', (req, res) => {
    res.status(501).json({
        type: 'error',
        error: {
            type: 'not_implemented',
            message: 'Token counting is not implemented. Use /v1/messages with max_tokens or configure your client to skip token counting.'
        }
    });
});

/**
 * Main messages endpoint - Anthropic Messages API compatible
 */
app.post('/v1/messages', async (req, res) => {
    try {
        // Ensure account manager is initialized
        await ensureInitialized();

        // Optimistic Retry: If ALL accounts are rate-limited, reset them to force a fresh check.
        // If we have some available accounts, we try them first.
        if (accountManager.isAllRateLimited()) {
            console.log('[Server] All accounts rate-limited. Resetting state for optimistic retry.');
            accountManager.resetAllRateLimits();
        }

        const {
            model,
            messages,
            max_tokens,
            stream,
            system,
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        } = req.body;

        // DEBUG: Log that we received a message request
        console.log(`[DEBUG] POST /v1/messages received - model: ${model}, messages: ${messages?.length} msgs`);

        // Validate required fields
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                type: 'error',
                error: {
                    type: 'invalid_request_error',
                    message: 'messages is required and must be an array'
                }
            });
        }

        // ================= NATURAL LANGUAGE MODEL SWITCHING =================
        // Detect phrases like "switch to grok", "use pro model", "change model to flash"
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        if (lastUserMsg) {
            const msgText = typeof lastUserMsg.content === 'string'
                ? lastUserMsg.content.toLowerCase()
                : (Array.isArray(lastUserMsg.content)
                    ? lastUserMsg.content.filter(c => c.type === 'text').map(c => c.text).join(' ').toLowerCase()
                    : '');

            // Pattern matching for model switch commands
            const switchPatterns = [
                /^\/model\s+(\w+[-\w]*)/i,  // Explicit /model command: "/model thinking"
                /(?:switch|change|use|set)\s+(?:to|the)?\s*(?:model\s+)?(?:to\s+)?(\w+[-\w]*)/i,
                /(?:model|switch)\s+(?:to\s+)?(\w+[-\w]*)/i
            ];

            for (const pattern of switchPatterns) {
                const match = msgText.match(pattern);
                if (match && match[1]) {
                    const requestedModel = match[1].toLowerCase();
                    const resolved = resolveModelAlias(requestedModel);
                    if (resolved && resolved !== requestedModel) {
                        setActiveModel(resolved);
                        console.log(`[NL-Switch] Natural language model switch: "${requestedModel}" → ${resolved}`);
                    } else if (['flash', 'pro', 'grok', 'opus', 'sonnet', 'kimi', 'gpt', 'perplexity', 'think', 'thinking', 'strong', 'powerful', 'fast', 'quick', 'search', 'sonar'].includes(requestedModel)) {
                        const resolved2 = resolveModelAlias(requestedModel);
                        if (resolved2) {
                            setActiveModel(resolved2);
                            console.log(`[NL-Switch] Natural language model switch: "${requestedModel}" → ${resolved2}`);
                        }
                    }
                    break;
                }
            }
        }

        // Build the request object (resolve model alias if used)
        // PASS-THROUGH MODE: Extension dropdown controls actual model
        // Dashboard only sets what the "Custom model" option uses

        // DEBUG: Log raw model name from extension
        console.log(`[DEBUG] Raw model from extension: "${model}"`);

        let resolvedModel = resolveModelAlias(model) || 'gemini-3-flash';
        const originalModelName = model; // Original model name from extension

        // ================= PER-SESSION MODEL (VIA HEADER) =================
        // Check for X-Session-ID header - allows each window/terminal to use different models
        const sessionId = req.headers['x-session-id'];
        let sessionModel = null;
        if (sessionId && sessionModels.has(sessionId)) {
            sessionModel = getSessionModel(sessionId);
            console.log(`[API] Per-session model for ${sessionId.slice(0, 8)}: ${sessionModel}`);
            resolvedModel = sessionModel;
        }

        // ================= PER-WINDOW MODEL OVERRIDE (VIA HEADER) =================
        // Check for X-Override-Model header - allows each VS Code window to use different models
        const headerOverrideModel = req.headers['x-override-model'];
        if (headerOverrideModel) {
            const resolvedHeader = resolveModelAlias(headerOverrideModel);
            console.log(`[API] Per-window model override via header: ${headerOverrideModel} → ${resolvedHeader}`);
            // Use header model directly, skip smart routing
            const enhancedSystem = (system || '') + `\n[SYSTEM INFO: You are currently running on ${resolvedHeader} via Antigravity Claude Proxy.]`;

            const request = {
                model: resolvedHeader,
                messages,
                max_tokens: max_tokens || 4096,
                stream,
                system: enhancedSystem,
                tools,
                tool_choice,
                thinking,
                top_p,
                top_k,
                temperature
            };

            logRequest('ROUTE', `WINDOW-OVERRIDE: ${headerOverrideModel} → ${resolvedHeader}`, 'per-window', null);

            // Continue with request processing... (handled by existing logic below that's skipped)
        }

        // ================= SMART ROUTING (FALLBACK TO GLOBAL) =================
        // Logic:
        // 1. Read what Custom model value is in settings.json
        // 2. If extension sends that value → Use dashboard override (Custom model follows dashboard)
        // 3. If extension sends Default/Opus/Haiku → Pass through directly

        // Get what Custom model value is currently set in settings.json
        let settingsCustomModel = null;
        try {
            if (fs.existsSync(ANTIGRAVITY_SETTINGS)) {
                const content = fs.readFileSync(ANTIGRAVITY_SETTINGS, 'utf-8');
                const match = content.match(/"claudeCode\.selectedModel"\s*:\s*"([^"]*)"/);
                if (match) settingsCustomModel = match[1];
            }
        } catch (e) { }

        // Precedence: X-Override-Model header, then the X-Session-ID session model, then smart routing
        resolvedModel = headerOverrideModel
            ? resolveModelAlias(headerOverrideModel)
            : (sessionModel || resolveModelAlias(model) || 'gemini-3-flash');

        // Check if extension is sending the Custom model value (from settings.json)
        const isUsingCustomModel = settingsCustomModel && resolvedModel === settingsCustomModel;

        if (!headerOverrideModel && !sessionModel) {
            // ================= LAST-CHANGE-WINS LOGIC =================
            // Status bar/dashboard sets globalModelOverride and syncs to settings.json
            // Claude Code reads settings.json for Custom model value
            // When Claude Code sends a model matching globalModelOverride, it's reflecting our choice

            const currentExtensionModel = resolveModelAlias(model);

            // If incoming model matches our override, Claude Code is reflecting our status bar choice
            if (globalModelOverride && currentExtensionModel === globalModelOverride) {
                // Claude Code is using what we set - keep using override
                console.log(`[API] Using model from status bar: ${globalModelOverride}`);
                resolvedModel = globalModelOverride;
            } else if (lastExtensionModel && currentExtensionModel !== lastExtensionModel && currentExtensionModel !== globalModelOverride) {
                // User switched to a DIFFERENT model via Claude Code UI
                // Update globalModelOverride to match so status bar shows correct model
                console.log(`[API] Claude Code UI changed: ${lastExtensionModel} → ${currentExtensionModel} (syncing to status bar)`);
                setActiveModel(currentExtensionModel);  // This updates globalModelOverride AND persists it
                resolvedModel = currentExtensionModel;
            } else if (globalModelOverride) {
                // Status bar override is set, use it
                console.log(`[API] Using status bar override: ${globalModelOverride}`);
                resolvedModel = globalModelOverride;
            } else {
                // No override, use what Claude Code sent and sync to status bar
                console.log(`[API] Using Claude Code model: ${currentExtensionModel}`);
                setActiveModel(currentExtensionModel);  // Sync to status bar
                resolvedModel = currentExtensionModel;
            }

            // Update tracking for next request
            lastExtensionModel = currentExtensionModel;
        }

        // ================= MODEL INFO INJECTION =================
        // Add active model info to system prompt so AI knows what it's using
        let enhancedSystem = system || '';
        const modelInfo = `\n[SYSTEM INFO: You are currently running on ${resolvedModel} via Antigravity Claude Proxy.]`;
        enhancedSystem = enhancedSystem + modelInfo;

        const request = {
            model: resolvedModel,
            messages,
            max_tokens: max_tokens || 4096,
            stream,
            system: enhancedSystem || system,  // Use enhanced system with model info
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        };

        const requestStartTime = Date.now();
        console.log(`[API] Request for model: ${request.model}, stream: ${!!stream}, messages: ${messages.length}`);

        // Log full routing flow to file for verification
        const routingInfo = `RECEIVED: ${originalModelName} → OVERRIDE: ${globalModelOverride || 'none'} → SENT: ${request.model}`;
        logRequest('ROUTE', routingInfo, globalModelOverride ? 'dashboard-override' : 'extension', null);

        // Debug: Log message structure to diagnose tool_use/tool_result ordering
        if (process.env.DEBUG) {
            console.log('[API] Message structure:');
            messages.forEach((msg, i) => {
                const contentTypes = Array.isArray(msg.content)
                    ? msg.content.map(c => c.type || 'text').join(', ')
                    : (typeof msg.content === 'string' ? 'text' : 'unknown');
                console.log(`  [${i}] ${msg.role}: ${contentTypes}`);
            });
        }

        // Route to Perplexity if model is sonar, perplexity, or pplx- prefixed
        const modelLower = request.model.toLowerCase();
        let isPerplexityModel = modelLower.includes('sonar') ||
            modelLower.includes('perplexity') ||
            modelLower.startsWith('pplx-');

        // AUTO-FALLBACK: If Perplexity model is used WITH tools, switch to Gemini
        // Perplexity API doesn't support tool use - it will hallucinate actions
        const hasTools = tools && Array.isArray(tools) && tools.length > 0;
        if (isPerplexityModel && hasTools) {
            const originalModel = request.model;
            request.model = 'gemini-3-flash'; // Fallback to fast agentic model
            isPerplexityModel = false;
            console.log(`[API] ⚠️ AUTO-FALLBACK: ${originalModel} → gemini-3-flash (Perplexity can't use tools)`);
        }

        if (isPerplexityModel) {
            console.log('[API] Routing to Perplexity via Python Server (curl_cffi)');
            try {
                // Forward to Python server running on port 8000
                // The Python server uses curl_cffi for TLS fingerprint impersonation
                const pythonServerUrl = 'http://localhost:8000/v1/chat/completions';

                // Convert Anthropic format to OpenAI format for Python server
                const openaiPayload = {
                    model: request.model,
                    messages: messages.map(m => ({
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content :
                            m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                    })),
                    stream: stream  // Use the stream flag from request
                };

                if (system) {
                    openaiPayload.messages.unshift({ role: 'system', content: system });
                }

                console.log(`[API] Forwarding to Python server: ${pythonServerUrl} (stream: ${stream})`);
                const pythonResponse = await fetch(pythonServerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(openaiPayload)
                });

                if (!pythonResponse.ok) {
                    const errorText = await pythonResponse.text();
                    throw new Error(`Python server error: ${pythonResponse.status} - ${errorText}`);
                }

                if (stream) {
                    // Handle streaming response - convert OpenAI SSE to Anthropic SSE
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('X-Accel-Buffering', 'no');
                    res.flushHeaders();

                    const msgId = `msg_pplx_${Date.now()}`;
                    let fullText = '';

                    // Send message_start
                    const startEvent = {
                        type: 'message_start',
                        message: {
                            id: msgId,
                            type: 'message',
                            role: 'assistant',
                            content: [],
                            model: request.model,
                            stop_reason: null,
                            stop_sequence: null,
                            usage: { input_tokens: 0, output_tokens: 0 }
                        }
                    };
                    res.write(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`);

                    // Send content_block_start
                    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);

                    // Process SSE stream from Python server
                    const reader = pythonResponse.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                if (data === '[DONE]') continue;
                                try {
                                    const chunk = JSON.parse(data);
                                    const delta = chunk.choices?.[0]?.delta?.content || '';
                                    if (delta) {
                                        fullText += delta;
                                        const textDelta = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } };
                                        res.write(`event: content_block_delta\ndata: ${JSON.stringify(textDelta)}\n\n`);
                                    }
                                } catch (e) { /* ignore parse errors */ }
                            }
                        }
                    }

                    // Send content_block_stop
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);

                    // Send message_delta with stop_reason
                    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: fullText.length } })}\n\n`);

                    // Send message_stop
                    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

                    trackModelUsage('perplexity', request.model);
                    res.end();
                } else {
                    // Non-streaming response
                    const openaiResult = await pythonResponse.json();

                    // Convert OpenAI response back to Anthropic format
                    const anthropicResponse = {
                        id: openaiResult.id || `msg_pplx_${Date.now()}`,
                        type: 'message',
                        role: 'assistant',
                        content: [{
                            type: 'text',
                            text: openaiResult.choices?.[0]?.message?.content || 'No response from Perplexity'
                        }],
                        model: request.model,
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                        usage: openaiResult.usage || { input_tokens: 0, output_tokens: 0 }
                    };

                    // Track usage
                    trackModelUsage('perplexity', request.model);
                    res.json(anthropicResponse);
                }
            } catch (err) {
                console.error('[API] Perplexity Error:', err);
                const { errorType, errorMessage } = parseError(err);
                res.status(500).json({
                    type: 'error',
                    error: { type: errorType, message: errorMessage }
                });
            }
        } else if (stream) {
            // Handle streaming response
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            // Flush headers immediately to start the stream
            res.flushHeaders();

            try {
                // Use the streaming generator with account manager
                for await (const event of sendMessageStream(request, accountManager)) {
                    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    // Flush after each event for real-time streaming
                    if (res.flush) res.flush();
                }
                // Track usage for streaming
                trackModelUsage('google', request.model);
                const elapsed = Date.now() - requestStartTime;
                console.log(`[API] Stream completed for ${request.model} in ${elapsed}ms`);
                res.end();

            } catch (streamError) {
                console.error('[API] Stream error:', streamError);

                const { errorType, errorMessage } = parseError(streamError);

                res.write(`event: error\ndata: ${JSON.stringify({
                    type: 'error',
                    error: { type: errorType, message: errorMessage }
                })}\n\n`);
                res.end();
            }

        } else {
            // Handle non-streaming response
            const response = await sendMessage(request, accountManager);
            // Track usage for non-streaming
            trackModelUsage('google', request.model);
            const elapsed = Date.now() - requestStartTime;
            console.log(`[API] Non-streaming response for ${request.model} in ${elapsed}ms`);
            res.json(response);
        }

    } catch (error) {
        console.error('[API] Error:', error);

        let { errorType, statusCode, errorMessage } = parseError(error);

        // For auth errors, try to refresh token
        if (errorType === 'authentication_error') {
            console.log('[API] Token might be expired, attempting refresh...');
            try {
                accountManager.clearProjectCache();
                accountManager.clearTokenCache();
                await forceRefresh();
                errorMessage = 'Token was expired and has been refreshed. Please retry your request.';
            } catch (refreshError) {
                errorMessage = 'Could not refresh token. Make sure Antigravity is running.';
            }
        }

        console.log(`[API] Returning error response: ${statusCode} ${errorType} - ${errorMessage}`);

        // Check if headers have already been sent (for streaming that failed mid-way)
        if (res.headersSent) {
            console.log('[API] Headers already sent, writing error as SSE event');
            res.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: errorType, message: errorMessage }
            })}\n\n`);
            res.end();
        } else {
            res.status(statusCode).json({
                type: 'error',
                error: {
                    type: errorType,
                    message: errorMessage
                }
            });
        }
    }
});

/**
 * Catch-all for unsupported endpoints
 */
app.use('*', (req, res) => {
    res.status(404).json({
        type: 'error',
        error: {
            type: 'not_found_error',
            message: `Endpoint ${req.method} ${req.originalUrl} not found`
        }
    });
});

export default app;
