// @ts-check
/**
 * Signature Cache
 * In-memory cache for Gemini thoughtSignatures
 *
 * Gemini models require thoughtSignature on tool calls, but Claude Code
 * strips non-standard fields. This cache stores signatures by tool_use_id
 * so they can be restored in subsequent requests.
 */

import { GEMINI_SIGNATURE_CACHE_TTL_MS } from '../constants.js';

const signatureCache = new Map();

/**
 * Store a signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @param {string} signature - The thoughtSignature to cache
 */
export function cacheSignature(toolUseId, signature) {
    if (!toolUseId || !signature) return;
    signatureCache.set(toolUseId, {
        signature,
        timestamp: Date.now()
    });
}

/**
 * Get a cached signature for a tool_use_id
 * @param {string} toolUseId - The tool use ID
 * @returns {string|null} The cached signature or null if not found/expired
 */
export function getCachedSignature(toolUseId) {
    if (!toolUseId) return null;
    const entry = signatureCache.get(toolUseId);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
        signatureCache.delete(toolUseId);
        return null;
    }

    return entry.signature;
}

/**
 * Clear expired entries from the cache
 * Can be called periodically to prevent memory buildup
 */
export function cleanupCache() {
    const now = Date.now();
    for (const [key, entry] of signatureCache) {
        if (now - entry.timestamp > GEMINI_SIGNATURE_CACHE_TTL_MS) {
            signatureCache.delete(key);
        }
    }
}

/**
 * Get the current cache size (for debugging)
 * @returns {number} Number of entries in the cache
 */
export function getCacheSize() {
    return signatureCache.size;
}
