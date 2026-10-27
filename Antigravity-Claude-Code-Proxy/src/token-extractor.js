/**
 * Token Extractor Module
 * Extracts OAuth tokens from Antigravity's SQLite database
 *
 * The database is automatically updated by Antigravity when tokens refresh,
 * so this approach doesn't require any manual intervention.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import {
    TOKEN_REFRESH_INTERVAL_MS,
    ANTIGRAVITY_AUTH_PORT,
    ANTIGRAVITY_DB_PATH
} from './constants.js';

// Cache for the extracted token
let cachedToken = null;
let tokenExtractedAt = null;

/**
 * Validate that a database path is safe to use
 * @param {string} dbPath - Path to validate
 * @returns {boolean} True if path is valid
 */
function isValidDbPath(dbPath) {
    if (!dbPath || typeof dbPath !== 'string') {
        return false;
    }
    // Check path doesn't contain shell metacharacters
    const dangerousChars = /[;&|`$(){}[\]<>!#*?]/;
    if (dangerousChars.test(dbPath)) {
        console.error('[Token] Database path contains invalid characters');
        return false;
    }
    return true;
}

/**
 * Extract token from Antigravity's SQLite database using native library
 * This is the preferred method as the DB is auto-updated
 * @param {string} dbPath - Path to SQLite database (defaults to ANTIGRAVITY_DB_PATH)
 * @returns {Object} Auth data containing apiKey, name, email, etc.
 * @throws {Error} If database read fails or no auth status found
 */
function extractTokenFromDB(dbPath = ANTIGRAVITY_DB_PATH) {
    try {
        // Validate path
        if (!isValidDbPath(dbPath)) {
            throw new Error('Invalid database path');
        }

        // Check if database file exists
        if (!existsSync(dbPath)) {
            throw new Error(`Database file not found: ${dbPath}`);
        }

        // Open database in read-only mode for safety
        const db = new Database(dbPath, { readonly: true });

        try {
            const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'");
            const row = stmt.get();

            if (!row || !row.value) {
                throw new Error('No auth status found in database');
            }

            const authData = JSON.parse(row.value);
            return {
                apiKey: authData.apiKey,
                name: authData.name,
                email: authData.email,
                // Include other fields we might need
                ...authData
            };
        } finally {
            db.close();
        }
    } catch (error) {
        console.error('[Token] Database extraction failed:', error.message);
        throw error;
    }
}

/**
 * Extract the chat params from Antigravity's HTML page (fallback method)
 */
async function extractChatParams() {
    try {
        const response = await fetch(`http://127.0.0.1:${ANTIGRAVITY_AUTH_PORT}/`);
        const html = await response.text();

        // Find the base64-encoded chatParams in the HTML
        const match = html.match(/window\.chatParams\s*=\s*'([^']+)'/);
        if (!match) {
            throw new Error('Could not find chatParams in Antigravity page');
        }

        // Decode base64
        const base64Data = match[1];
        const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
        const config = JSON.parse(jsonString);

        return config;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(
                `Cannot connect to Antigravity on port ${ANTIGRAVITY_AUTH_PORT}. ` +
                'Make sure Antigravity is running.',
                { cause: error }
            );
        }
        throw error;
    }
}

/**
 * Get fresh token data - tries DB first, falls back to HTML page
 */
async function getTokenData() {
    // Try database first (preferred - always has fresh token)
    try {
        const dbData = extractTokenFromDB();
        if (dbData?.apiKey) {
            console.log('[Token] Got fresh token from SQLite database');
            return dbData;
        }
    } catch (err) {
        console.log('[Token] DB extraction failed, trying HTML page...');
    }

    // Fallback to HTML page
    try {
        const pageData = await extractChatParams();
        if (pageData?.apiKey) {
            console.log('[Token] Got token from HTML page (may be stale)');
            return pageData;
        }
    } catch (err) {
        console.log('[Token] HTML page extraction failed:', err.message);
    }

    throw new Error(
        'Could not extract token from Antigravity. ' +
        'Make sure Antigravity is running and you are logged in.'
    );
}

/**
 * Check if the cached token needs refresh
 */
function needsRefresh() {
    if (!cachedToken || !tokenExtractedAt) {
        return true;
    }
    return Date.now() - tokenExtractedAt > TOKEN_REFRESH_INTERVAL_MS;
}

/**
 * Get the current OAuth token (with caching)
 */
export async function getToken() {
    if (needsRefresh()) {
        const data = await getTokenData();
        cachedToken = data.apiKey;
        tokenExtractedAt = Date.now();
    }
    return cachedToken;
}

/**
 * Force refresh the token (useful if requests start failing)
 */
export async function forceRefresh() {
    cachedToken = null;
    tokenExtractedAt = null;
    return getToken();
}

export default {
    getToken,
    forceRefresh,
    extractTokenFromDB,
    isValidDbPath
};
