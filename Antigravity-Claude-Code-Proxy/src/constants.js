/**
 * Constants for Antigravity Cloud Code API integration
 * Based on: https://github.com/NoeFabris/opencode-antigravity-auth
 *
 * Configuration values can be overridden via environment variables.
 * See .env.example for available options.
 */

import { config } from 'dotenv';
import { homedir, platform, arch } from 'os';
import { join } from 'path';

// Load environment variables from .env file
config();

/**
 * Get environment variable with optional default value
 * @param {string} name - Environment variable name
 * @param {string|number|undefined} defaultValue - Default value if not set
 * @returns {string|undefined} The environment variable value or default
 */
function getEnv(name, defaultValue = undefined) {
    return process.env[name] ?? defaultValue;
}

/**
 * Get environment variable as integer with default value
 * @param {string} name - Environment variable name
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number} The parsed integer value
 */
function getEnvInt(name, defaultValue) {
    const value = process.env[name];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get the Antigravity database path based on the current platform.
 * - macOS: ~/Library/Application Support/Antigravity/...
 * - Windows: ~/AppData/Roaming/Antigravity/...
 * - Linux/other: ~/.config/Antigravity/...
 * @returns {string} Full path to the Antigravity state database
 */
function getAntigravityDbPath() {
    const home = homedir();
    switch (platform()) {
        case 'darwin':
            return join(home, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
        case 'win32':
            return join(home, 'AppData/Roaming/Antigravity/User/globalStorage/state.vscdb');
        default: // linux, freebsd, etc.
            return join(home, '.config/Antigravity/User/globalStorage/state.vscdb');
    }
}

/**
 * Generate platform-specific User-Agent string.
 * @returns {string} User-Agent in format "antigravity/version os/arch"
 */
function getPlatformUserAgent() {
    const os = platform();
    const architecture = arch();
    return `antigravity/1.11.5 ${os}/${architecture}`;
}

// Cloud Code API endpoints (in fallback order)
const ANTIGRAVITY_ENDPOINT_DAILY = 'https://daily-cloudcode-pa.sandbox.googleapis.com';
const ANTIGRAVITY_ENDPOINT_PROD = 'https://cloudcode-pa.googleapis.com';

// Endpoint fallback order (daily → prod)
// Can be overridden with a comma-separated CLOUDCODE_ENDPOINTS list (e.g. for a local mock in tests)
export const ANTIGRAVITY_ENDPOINT_FALLBACKS = getEnv('CLOUDCODE_ENDPOINTS')
    ? getEnv('CLOUDCODE_ENDPOINTS').split(',').map(e => e.trim().replace(/\/+$/, '')).filter(Boolean)
    : [
        ANTIGRAVITY_ENDPOINT_DAILY,
        ANTIGRAVITY_ENDPOINT_PROD
    ];

// Required headers for Antigravity API requests
export const ANTIGRAVITY_HEADERS = {
    'User-Agent': getPlatformUserAgent(),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
    })
};

// Default project ID if none can be discovered
export const DEFAULT_PROJECT_ID = getEnv('DEFAULT_PROJECT_ID', 'rising-fact-p41fc');

// Server configuration (can be overridden via environment variables)
export const DEFAULT_PORT = getEnvInt('PORT', 8080);
// Bind to loopback by default so the proxy (and the accounts behind it) is not exposed to the network.
// Set HOST=0.0.0.0 to listen on all interfaces.
export const DEFAULT_HOST = getEnv('HOST', '127.0.0.1');
export const REQUEST_BODY_LIMIT = getEnv('REQUEST_BODY_LIMIT', '50mb');

// Token and timing configuration
export const TOKEN_REFRESH_INTERVAL_MS = getEnvInt('TOKEN_REFRESH_INTERVAL', 5 * 60 * 1000); // 5 minutes
export const DEFAULT_COOLDOWN_MS = getEnvInt('RATE_LIMIT_COOLDOWN', 60 * 1000); // 1 minute default cooldown
export const MAX_WAIT_BEFORE_ERROR_MS = getEnvInt('MAX_WAIT_BEFORE_ERROR', 120000); // 2 minutes

// Auto-wait mode: When enabled, waits indefinitely for rate limits to reset instead of throwing errors
// Set to 'true' or '1' to enable
export const AUTO_WAIT_FOR_RATE_LIMIT = getEnv('AUTO_WAIT_FOR_RATE_LIMIT', 'true') === 'true' ||
    getEnv('AUTO_WAIT_FOR_RATE_LIMIT', 'true') === '1';

// Progress update interval during long waits (in milliseconds)
export const RATE_LIMIT_PROGRESS_INTERVAL_MS = getEnvInt('RATE_LIMIT_PROGRESS_INTERVAL', 30000); // 30 seconds

// Maximum time to wait for rate limit reset (0 = infinite)
export const MAX_RATE_LIMIT_WAIT_MS = getEnvInt('MAX_RATE_LIMIT_WAIT', 0); // 0 = wait forever

// Retry and account limits
export const MAX_RETRIES = getEnvInt('MAX_RETRIES', 5); // Max retry attempts across accounts
export const MAX_ACCOUNTS = getEnvInt('MAX_ACCOUNTS', 10); // Maximum number of accounts allowed

// Request timeout (new)
export const REQUEST_TIMEOUT_MS = getEnvInt('REQUEST_TIMEOUT', 60000); // 60 seconds default

// Antigravity auth port
export const ANTIGRAVITY_AUTH_PORT = getEnvInt('ANTIGRAVITY_AUTH_PORT', 9092);

// Multi-account configuration
export const ACCOUNT_CONFIG_PATH = getEnv('ACCOUNT_CONFIG_PATH', join(
    homedir(),
    '.config/antigravity-proxy/accounts.json'
));

// Perplexity account configuration
export const PERPLEXITY_CONFIG_PATH = getEnv('PERPLEXITY_CONFIG_PATH', join(
    homedir(),
    '.config/antigravity-proxy/perplexity_accounts.json'
));

// Antigravity app database path (for legacy single-account token extraction)
// Uses platform-specific path detection
export const ANTIGRAVITY_DB_PATH = getAntigravityDbPath();

// Thinking model constants
export const MIN_SIGNATURE_LENGTH = 50; // Minimum valid thinking signature length

// Gemini-specific limits
export const GEMINI_MAX_OUTPUT_TOKENS = getEnvInt('GEMINI_MAX_OUTPUT_TOKENS', 16384);

// Gemini signature handling
// Sentinel value to skip thought signature validation when Claude Code strips the field
// See: https://ai.google.dev/gemini-api/docs/thought-signatures
export const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

// Cache TTL for Gemini thoughtSignatures (2 hours)
export const GEMINI_SIGNATURE_CACHE_TTL_MS = getEnvInt('GEMINI_SIGNATURE_CACHE_TTL', 2 * 60 * 60 * 1000);

// Logging configuration
export const LOG_LEVEL = getEnv('LOG_LEVEL', 'info');

/**
 * Get the model family from model name (dynamic detection, no hardcoded list).
 * @param {string} modelName - The model name from the request
 * @returns {'claude' | 'gemini' | 'unknown'} The model family
 */
export function getModelFamily(modelName) {
    const lower = (modelName || '').toLowerCase();
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini')) return 'gemini';
    return 'unknown';
}

/**
 * Model aliases for easy natural language switching
 * Users can type "/model flash" instead of "/model gemini-3-flash"
 */
export const MODEL_ALIASES = {
    // Fast models (for quick tasks) - AGENTIC
    'flash': 'gemini-3-flash',
    'fast': 'gemini-3-flash',
    'quick': 'gemini-3-flash',
    'haiku': 'gemini-3-flash', // Haiku → fast Gemini model

    // Pro models (stronger) - AGENTIC
    'pro': 'gemini-3-pro-high',
    'strong': 'gemini-3-pro-high',
    'powerful': 'gemini-3-pro-high',

    // Thinking models - AGENTIC
    'think': 'gemini-2.5-flash-thinking',
    'thinking': 'gemini-2.5-flash-thinking',

    // Perplexity models - CHAT ONLY (no tool use!)
    'grok': 'pplx-grok',
    'kimi': 'pplx-kimi',
    'claude': 'pplx-claude-opus',
    'opus': 'pplx-claude-opus',
    'sonnet': 'pplx-claude-sonnet',
    'gpt': 'pplx-gpt51',
    'gpt5': 'pplx-gpt51',
    'pplx': 'perplexity-auto',
    'perplexity': 'perplexity-auto',
    'search': 'sonar',

    // Sonar models (Perplexity's web search models) - CHAT ONLY
    'sonar': 'sonar',
    'sonar-pro': 'sonar-pro',
    'sonar-reasoning': 'sonar-reasoning',
    'sonar-deep': 'sonar-deep-research',
    'research': 'sonar-deep-research',

    // Google AI Claude models - AGENTIC
    'claude-opus': 'claude-opus-4-5-thinking',
    'claude-sonnet': 'claude-sonnet-4-5-thinking',

    // ===== ANTHROPIC MODEL MAPPINGS (from dropdown) =====
    // These map the full Anthropic model names to Gemini equivalents
    // Haiku = Fast model
    'claude-3-haiku-20240307': 'gemini-3-flash',
    'claude-3-5-haiku-20241022': 'gemini-3-flash',
    'claude-3-5-haiku-latest': 'gemini-3-flash',

    // Sonnet = Available on Google AI as claude-sonnet-4-5-thinking
    'claude-3-sonnet-20240229': 'claude-sonnet-4-5-thinking',
    'claude-3-5-sonnet-20240620': 'claude-sonnet-4-5-thinking',
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-5-thinking',
    'claude-3-5-sonnet-latest': 'claude-sonnet-4-5-thinking',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-5-thinking',

    // Opus = Available on Google AI as claude-opus-4-5-thinking
    'claude-3-opus-20240229': 'claude-opus-4-5-thinking',
    'claude-3-opus-latest': 'claude-opus-4-5-thinking',
    'claude-opus-4-20250514': 'claude-opus-4-5-thinking',
};

/**
 * Resolve model name from alias or return original
 * @param {string} modelName - Model name or alias
 * @returns {string} Resolved model name
 */
export function resolveModelAlias(modelName) {
    const lower = (modelName || '').toLowerCase().trim();
    return MODEL_ALIASES[lower] || modelName;
}

/**
 * Check if a model supports thinking/reasoning output.
 * @param {string} modelName - The model name from the request
 * @returns {boolean} True if the model supports thinking blocks
 */
export function isThinkingModel(modelName) {
    const lower = (modelName || '').toLowerCase();

    // Flash and lite models should NEVER use extended thinking (fast models)
    if (lower.includes('flash') || lower.includes('lite')) return false;

    // Claude thinking models have "thinking" in the name
    if (lower.includes('claude') && lower.includes('thinking')) return true;

    // Gemini thinking models: only if explicitly "thinking" in name or pro/high models
    if (lower.includes('gemini')) {
        if (lower.includes('thinking')) return true;
        // Only pro-high uses thinking, not flash
        if (lower.includes('pro-high')) return true;
    }
    return false;
}

// Default OAuth credentials (can be overridden via environment variables)
// Note: These are public OAuth credentials for the Antigravity integration.
// For custom OAuth apps, set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET
const DEFAULT_OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
// The client secret is not stored in the repository: set GOOGLE_OAUTH_CLIENT_SECRET in the environment (or .env).

// Google OAuth configuration
export const OAUTH_CONFIG = {
    clientId: getEnv('GOOGLE_OAUTH_CLIENT_ID', DEFAULT_OAUTH_CLIENT_ID),
    clientSecret: getEnv('GOOGLE_OAUTH_CLIENT_SECRET', ''),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
    callbackPort: getEnvInt('OAUTH_CALLBACK_PORT', 51121),
    scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs'
    ]
};
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CONFIG.callbackPort}/oauth-callback`;

export default {
    ANTIGRAVITY_ENDPOINT_FALLBACKS,
    ANTIGRAVITY_HEADERS,
    DEFAULT_PROJECT_ID,
    TOKEN_REFRESH_INTERVAL_MS,
    REQUEST_BODY_LIMIT,
    ANTIGRAVITY_AUTH_PORT,
    DEFAULT_PORT,
    DEFAULT_HOST,
    ACCOUNT_CONFIG_PATH,
    ANTIGRAVITY_DB_PATH,
    DEFAULT_COOLDOWN_MS,
    MAX_RETRIES,
    MAX_ACCOUNTS,
    MAX_WAIT_BEFORE_ERROR_MS,
    AUTO_WAIT_FOR_RATE_LIMIT,
    RATE_LIMIT_PROGRESS_INTERVAL_MS,
    MAX_RATE_LIMIT_WAIT_MS,
    REQUEST_TIMEOUT_MS,
    MIN_SIGNATURE_LENGTH,
    GEMINI_MAX_OUTPUT_TOKENS,
    GEMINI_SKIP_SIGNATURE,
    GEMINI_SIGNATURE_CACHE_TTL_MS,
    LOG_LEVEL,
    getModelFamily,
    isThinkingModel,
    OAUTH_CONFIG,
    OAUTH_REDIRECT_URI
};
