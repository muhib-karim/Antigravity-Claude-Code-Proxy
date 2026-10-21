// @ts-check
/**
 * Shared Utility Functions
 *
 * General-purpose helper functions used across multiple modules.
 */

import {
    RATE_LIMIT_PROGRESS_INTERVAL_MS
} from '../constants.js';

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration (e.g., "1h23m45s")
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h${minutes}m${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m${secs}s`;
    }
    return `${secs}s`;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Duration to sleep in milliseconds
 * @returns {Promise<void>} Resolves after the specified duration
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for rate limit reset with progress feedback
 * Prints countdown progress to console every RATE_LIMIT_PROGRESS_INTERVAL_MS
 *
 * @param {number} waitMs - Total milliseconds to wait
 * @param {string} context - Context message (e.g., "all accounts rate-limited")
 * @param {Date} resetTime - When the rate limit resets
 * @returns {Promise<void>} Resolves when wait is complete
 */
export async function waitWithProgress(waitMs, context, resetTime) {
    const startTime = Date.now();
    const endTime = startTime + waitMs;

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  ⏳ Rate Limit - Auto-Wait Mode Active                       ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║  Status: ${context.padEnd(52)}║`);
    console.log(`║  Reset at: ${resetTime.toLocaleTimeString().padEnd(50)}║`);
    console.log(`║  Waiting: ${formatDuration(waitMs).padEnd(51)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

    // If wait is short, just wait without progress updates
    if (waitMs <= RATE_LIMIT_PROGRESS_INTERVAL_MS) {
        await sleep(waitMs);
        console.log(`[AutoWait] ✓ Rate limit reset! Resuming...`);
        return;
    }

    // For longer waits, show progress updates
    let remaining = waitMs;
    while (remaining > 0) {
        const sleepDuration = Math.min(remaining, RATE_LIMIT_PROGRESS_INTERVAL_MS);
        await sleep(sleepDuration);
        remaining = endTime - Date.now();

        if (remaining > 0) {
            console.log(`[AutoWait] ⏳ ${formatDuration(remaining)} remaining until rate limit reset...`);
        }
    }

    console.log(`[AutoWait] ✓ Rate limit reset! Resuming...`);
}
