// @ts-check
/**
 * Map internal and upstream errors to Anthropic Messages API error responses.
 *
 * Anthropic error types: invalid_request_error (400), authentication_error (401),
 * permission_error (403), not_found_error (404), request_too_large (413),
 * rate_limit_error (429), api_error (500), overloaded_error (529), timeout_error (504).
 */
import { isRateLimitError, isAuthError } from '../errors.js';
import { redactString } from '../utils/redact.js';

/**
 * @typedef {object} MappedError
 * @property {number} status - HTTP status for the client
 * @property {string} type - Anthropic error type
 * @property {string} message - Client-safe message (secrets redacted)
 * @property {number|null} retryAfterSeconds - Value for a `retry-after` header, if known
 *
 * @typedef {object} MapOptions
 * @property {400|429} [rateLimitStatus=400] - Status used when every account is out of quota.
 *   400 (the fork's historical default) stops Claude Code from hammering an exhausted quota;
 *   429 lets clients that honour `retry-after` wait and retry.
 */

/**
 * Parse durations produced by `formatDuration` ("1h2m3s", "5m0s", "42s").
 * @param {string} text
 * @returns {number|null} Milliseconds
 */
export function parseDurationMs(text) {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text || '');
    if (!match || !text) return null;
    const [, h = '0', m = '0', s = '0'] = match;
    return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}

/**
 * Coerce a status into one Express 5's `res.status()` accepts (an integer from 100 to 999);
 * anything else (undefined, NaN, '429', 4.5) becomes `fallback`.
 * @param {unknown} status
 * @param {number} [fallback=500]
 * @returns {number}
 */
export function toHttpStatus(status, fallback = 500) {
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 999 ? status : fallback;
}

/**
 * @param {number|null|undefined} ms
 * @returns {number|null}
 */
function toSeconds(ms) {
    return typeof ms === 'number' && ms > 0 ? Math.ceil(ms / 1000) : null;
}

/**
 * Pull `error.message` out of an upstream JSON error body embedded in our message.
 * @param {string} message
 * @returns {string|null}
 */
function extractUpstreamMessage(message) {
    const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(message);
    return match ? match[1] : null;
}

/**
 * @param {number} status
 * @param {string} type
 * @param {string} message
 * @param {number|null} [retryAfterSeconds]
 * @returns {MappedError}
 */
function result(status, type, message, retryAfterSeconds = null) {
    return { status, type, message: redactString(message), retryAfterSeconds };
}

/**
 * Map any thrown value to an Anthropic error response.
 * @param {unknown} thrown
 * @param {MapOptions} [options]
 * @returns {MappedError}
 */
export function mapError(thrown, options = {}) {
    const { rateLimitStatus = 400 } = options;
    /** @type {any} */
    const error = thrown instanceof Error ? thrown : new Error(String(thrown ?? 'Unknown error'));
    const message = String(error.message || 'Unknown error');
    // Only well-formed integer codes count; a numeric string from an upstream body is accepted too
    const rawStatus = typeof error.statusCode === 'string' ? Number(error.statusCode) : error.statusCode;
    const statusCode = toHttpStatus(rawStatus, 0) || null;

    // express.json() / body-parser failures
    if (error.type === 'entity.parse.failed') {
        return result(400, 'invalid_request_error', 'Request body is not valid JSON');
    }
    if (error.type === 'entity.too.large' || error.status === 413) {
        return result(413, 'request_too_large', 'Request body exceeds the configured size limit');
    }
    if (error.name === 'RequestValidationError') {
        return result(400, 'invalid_request_error', message);
    }
    if (error.name === 'TimeoutError' || error.code === 'TIMEOUT') {
        return result(504, 'timeout_error', message);
    }

    if (statusCode === 429 || (statusCode === null && isRateLimitError(error))) {
        const resetMatch = /quota will reset after (\d+h\d+m\d+s|\d+m\d+s|\d+s)/i.exec(message);
        const retryAfterMs =
            error.retryAfterMs ?? error.resetMs ?? (resetMatch ? parseDurationMs(resetMatch[1]) : null);
        const modelMatch = /"model":\s*"([^"]+)"/.exec(message);
        const model = modelMatch ? modelMatch[1] : 'the model';
        const text = resetMatch
            ? `You have exhausted your capacity on ${model}. Quota will reset after ${resetMatch[1]}.`
            : `You have exhausted your capacity on ${model}. Please wait for your quota to reset.`;
        return rateLimitStatus === 429
            ? result(429, 'rate_limit_error', text, toSeconds(retryAfterMs))
            : result(400, 'invalid_request_error', text, toSeconds(retryAfterMs));
    }

    // Text matching is only a fallback for errors that carry no upstream status
    if (statusCode === 401 || isAuthError(error) || (statusCode === null && /\b401\b|UNAUTHENTICATED/.test(message))) {
        return result(
            401,
            'authentication_error',
            'Authentication with the upstream failed. Re-authenticate the account.'
        );
    }

    if (statusCode !== null) {
        const upstreamMessage = extractUpstreamMessage(message) || message;
        if (statusCode === 400) return result(400, 'invalid_request_error', upstreamMessage);
        if (statusCode === 403) return result(403, 'permission_error', upstreamMessage);
        if (statusCode === 404) return result(404, 'not_found_error', upstreamMessage);
        if (statusCode === 413) return result(413, 'request_too_large', upstreamMessage);
        if (statusCode === 503 || statusCode === 529) {
            return result(
                529,
                'overloaded_error',
                'The upstream is overloaded. Retry later.',
                toSeconds(error.retryAfterMs)
            );
        }
        if (statusCode >= 500) return result(502, 'api_error', `Upstream error ${statusCode}: ${upstreamMessage}`);
        if (statusCode >= 400) return result(statusCode, 'invalid_request_error', upstreamMessage);
    }

    if (message.includes('invalid_request_error') || message.includes('INVALID_ARGUMENT')) {
        return result(400, 'invalid_request_error', extractUpstreamMessage(message) || message);
    }
    if (message.includes('PERMISSION_DENIED')) {
        return result(403, 'permission_error', 'Permission denied by the upstream. Check the account licence.');
    }
    if (/All endpoints failed|fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET/.test(message)) {
        return result(503, 'api_error', 'Unable to reach the upstream API.');
    }

    return result(500, 'api_error', message);
}
