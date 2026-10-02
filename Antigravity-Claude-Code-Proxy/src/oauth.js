/**
 * Google OAuth with PKCE for Antigravity
 *
 * Implements the same OAuth flow as opencode-antigravity-auth
 * to obtain refresh tokens for multiple Google accounts.
 * Uses a local callback server to automatically capture the auth code.
 */

import crypto from 'crypto';
import http from 'http';
import {
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    OAUTH_CONFIG,
    OAUTH_REDIRECT_URI
} from './constants.js';

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');
    return { verifier, challenge };
}

/**
 * Generate authorization URL for Google OAuth
 * Returns the URL and the PKCE verifier (needed for token exchange)
 *
 * @returns {{url: string, verifier: string, state: string}} Auth URL and PKCE data
 */
export function getAuthorizationUrl() {
    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
        client_id: OAUTH_CONFIG.clientId,
        redirect_uri: OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: OAUTH_CONFIG.scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state
    });

    return {
        url: `${OAUTH_CONFIG.authUrl}?${params.toString()}`,
        verifier,
        state
    };
}

/**
 * Start a local server to receive the OAuth callback
 * Returns a promise that resolves with the authorization code
 *
 * @param {string} expectedState - Expected state parameter for CSRF protection
 * @param {number} timeoutMs - Timeout in milliseconds (default 120000)
 * @returns {Promise<string>} Authorization code from OAuth callback
 */

// ============ PERSISTENT CALLBACK SERVER FOR MULTI-STATE OAUTH ============
// This design allows multiple OAuth flows to run concurrently

let persistentServer = null;
const pendingFlows = new Map(); // state -> { verifier, resolve, reject, timeout }

// Force close the callback server and clear all flows
export function closeCallbackServer() {
    if (!persistentServer && pendingFlows.size === 0) return;
    console.log('[OAuth] Closing callback server and clearing all flows');
    // Clear all pending flow timeouts
    for (const [state, flow] of pendingFlows) {
        if (flow.timeout) clearTimeout(flow.timeout);
    }
    pendingFlows.clear();

    if (persistentServer) {
        try {
            persistentServer.close();
        } catch (e) {
            // Ignore close errors
        }
        persistentServer = null;
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
}

// Ensure the persistent callback server is running
function ensurePersistentServer() {
    if (persistentServer) return;

    persistentServer = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${OAUTH_CONFIG.callbackPort}`);

        if (url.pathname !== '/oauth-callback') {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        console.log(`[OAuth] Callback received: state=${state?.slice(0, 8)}..., hasCode=${!!code}, error=${error || 'none'}`);

        // Look up the pending flow by state
        const flow = pendingFlows.get(state);

        if (!flow) {
            // Unknown or already-processed state
            console.log(`[OAuth] No pending flow for state ${state?.slice(0, 8)}... (may be stale)`);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head><title>Session Handled</title></head>
                <body style="font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: #fff;">
                    <h1 style="color: #ffc107;">⚠️ Session Already Processed</h1>
                    <p>This login session was already completed or timed out.</p>
                    <p style="color: #888;">You can close this window.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
            `);
            return;
        }

        // Clear the timeout for this flow
        if (flow.timeout) clearTimeout(flow.timeout);
        pendingFlows.delete(state);

        if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head><title>Authentication Failed</title></head>
                <body style="font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: #fff;">
                    <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                    <p>Error: ${escapeHtml(error)}</p>
                    <p style="color: #888;">You can close this window and try again.</p>
                    <script>setTimeout(() => window.close(), 3000);</script>
                </body>
                </html>
            `);
            flow.reject(new Error(`OAuth error: ${error}`));
            return;
        }

        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head><title>Authentication Failed</title></head>
                <body style="font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: #fff;">
                    <h1 style="color: #dc3545;">❌ Authentication Failed</h1>
                    <p>No authorization code received.</p>
                    <p style="color: #888;">You can close this window and try again.</p>
                    <script>setTimeout(() => window.close(), 3000);</script>
                </body>
                </html>
            `);
            flow.reject(new Error('No authorization code'));
            return;
        }

        // Success!
        console.log(`[OAuth] Flow ${state.slice(0, 8)}... completed successfully`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: #fff;">
                <h1 style="color: #28a745;">✅ Authentication Successful!</h1>
                <p>Account added successfully.</p>
                <p style="color: #888;">This window will close automatically...</p>
                <script>setTimeout(() => window.close(), 2000);</script>
            </body>
            </html>
        `);

        flow.resolve(code);
    });

    persistentServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('[OAuth] Port 51121 in use, will retry...');
            persistentServer = null;
        } else {
            console.error('[OAuth] Server error:', err.message);
        }
    });

    persistentServer.listen(OAUTH_CONFIG.callbackPort, () => {
        console.log(`[OAuth] Persistent callback server started on port ${OAUTH_CONFIG.callbackPort}`);
    });
}

export function startCallbackServer(expectedState, timeoutMs = 120000) {
    // Ensure persistent server is running (doesn't close existing one)
    ensurePersistentServer();

    return new Promise((resolve, reject) => {
        // Register this flow
        const flowTimeout = setTimeout(() => {
            console.log(`[OAuth] Flow ${expectedState.slice(0, 8)}... timed out after ${timeoutMs / 1000}s`);
            pendingFlows.delete(expectedState);
            reject(new Error('OAuth callback timeout'));
        }, timeoutMs);

        pendingFlows.set(expectedState, {
            resolve,
            reject,
            timeout: flowTimeout
        });

        console.log(`[OAuth] Registered flow ${expectedState.slice(0, 8)}... (${pendingFlows.size} pending)`);
    });
}

/**
 * Exchange authorization code for tokens
 *
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} verifier - PKCE code verifier
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>} OAuth tokens
 */
function requireClientSecret() {
    if (!OAUTH_CONFIG.clientSecret) {
        throw new Error('GOOGLE_OAUTH_CLIENT_SECRET is not set. Set it (with GOOGLE_OAUTH_CLIENT_ID if you use your own OAuth app) before adding or refreshing Google accounts.');
    }
}

export async function exchangeCode(code, verifier) {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: OAUTH_CONFIG.clientId,
            client_secret: (requireClientSecret(), OAUTH_CONFIG.clientSecret),
            code: code,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            redirect_uri: OAUTH_REDIRECT_URI
        })
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('[OAuth] Token exchange failed:', response.status, error);
        throw new Error(`Token exchange failed: ${error}`);
    }

    const tokens = await response.json();

    if (!tokens.access_token) {
        console.error('[OAuth] No access token in response:', tokens);
        throw new Error('No access token received');
    }

    console.log('[OAuth] Token exchange successful, access_token length:', tokens.access_token?.length);

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Refresh access token using refresh token
 *
 * @param {string} refreshToken - OAuth refresh token
 * @returns {Promise<{accessToken: string, expiresIn: number}>} New access token
 */
export async function refreshAccessToken(refreshToken) {
    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: OAUTH_CONFIG.clientId,
            client_secret: (requireClientSecret(), OAUTH_CONFIG.clientSecret),
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
    }

    const tokens = await response.json();
    return {
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in
    };
}

/**
 * Get user email from access token
 *
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<string>} User's email address
 */
export async function getUserEmail(accessToken) {
    const response = await fetch(OAUTH_CONFIG.userInfoUrl, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[OAuth] getUserEmail failed:', response.status, errorText);
        throw new Error(`Failed to get user info: ${response.status}`);
    }

    const userInfo = await response.json();
    return userInfo.email;
}

/**
 * Discover project ID for the authenticated user
 *
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<string|null>} Project ID or null if not found
 */
export async function discoverProjectId(accessToken) {
    for (const endpoint of ANTIGRAVITY_ENDPOINT_FALLBACKS) {
        try {
            const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    ...ANTIGRAVITY_HEADERS
                },
                body: JSON.stringify({
                    metadata: {
                        ideType: 'IDE_UNSPECIFIED',
                        platform: 'PLATFORM_UNSPECIFIED',
                        pluginType: 'GEMINI'
                    }
                })
            });

            if (!response.ok) continue;

            const data = await response.json();

            if (typeof data.cloudaicompanionProject === 'string') {
                return data.cloudaicompanionProject;
            }
            if (data.cloudaicompanionProject?.id) {
                return data.cloudaicompanionProject.id;
            }
        } catch (error) {
            console.log(`[OAuth] Project discovery failed at ${endpoint}:`, error.message);
        }
    }

    return null;
}

/**
 * Complete OAuth flow: exchange code and get all account info
 *
 * @param {string} code - Authorization code from OAuth callback
 * @param {string} verifier - PKCE code verifier
 * @returns {Promise<{email: string, refreshToken: string, accessToken: string, projectId: string|null}>} Complete account info
 */
export async function completeOAuthFlow(code, verifier) {
    // Exchange code for tokens
    const tokens = await exchangeCode(code, verifier);

    // Get user email
    const email = await getUserEmail(tokens.accessToken);

    // Discover project ID
    const projectId = await discoverProjectId(tokens.accessToken);

    return {
        email,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        projectId
    };
}

export default {
    getAuthorizationUrl,
    startCallbackServer,
    closeCallbackServer,
    exchangeCode,
    refreshAccessToken,
    getUserEmail,
    discoverProjectId,
    completeOAuthFlow
};
