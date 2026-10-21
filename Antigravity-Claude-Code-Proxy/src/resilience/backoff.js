// @ts-check
/**
 * Retry primitives for upstream calls: exponential backoff with jitter,
 * Retry-After parsing and a small generic retry loop.
 *
 * Pure functions with injectable randomness/sleep so they can be unit-tested
 * deterministically.
 */

/**
 * @typedef {'none' | 'full' | 'equal'} JitterMode
 *
 * @typedef {object} BackoffOptions
 * @property {number} [baseMs=500] - Delay for attempt 0 before jitter
 * @property {number} [maxMs=8000] - Upper bound for any computed delay
 * @property {number} [factor=2] - Exponential growth factor
 * @property {JitterMode} [jitter='full'] - Jitter strategy (AWS "full"/"equal" jitter)
 * @property {() => number} [random=Math.random] - Random source in [0, 1)
 */

/**
 * Compute the backoff delay for a zero-based retry attempt.
 * @param {number} attempt - 0 for the first retry, 1 for the second, ...
 * @param {BackoffOptions} [options]
 * @returns {number} Delay in milliseconds (integer)
 */
export function computeBackoff(attempt, options = {}) {
    if (!Number.isInteger(attempt) || attempt < 0) {
        throw new RangeError(`attempt must be a non-negative integer, got ${attempt}`);
    }
    const { baseMs = 500, maxMs = 8000, factor = 2, jitter = 'full', random = Math.random } = options;
    const exp = Math.min(maxMs, baseMs * Math.pow(factor, attempt));
    switch (jitter) {
        case 'none':
            return Math.round(exp);
        case 'equal':
            return Math.round(exp / 2 + random() * (exp / 2));
        default:
            return Math.floor(random() * exp);
    }
}

/**
 * Parse an HTTP Retry-After header value (delta-seconds or HTTP-date).
 * @param {string | null | undefined} value
 * @param {number} [nowMs=Date.now()]
 * @returns {number | null} Milliseconds to wait, or null when absent/invalid
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (trimmed === '') return null;
    if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
    // HTTP-date must contain letters (day/month names); bare numbers were handled above
    if (!/[a-z]/i.test(trimmed)) return null;
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) return null;
    return Math.max(0, date - nowMs);
}

/**
 * Delay before the next retry: the backoff, or the server's Retry-After when longer.
 * @param {number} attempt - Zero-based retry attempt
 * @param {number | null | undefined} retryAfterMs - Server-requested wait, if any
 * @param {BackoffOptions & {maxRetryAfterMs?: number}} [options]
 * @returns {number}
 */
export function retryDelay(attempt, retryAfterMs, options = {}) {
    const backoff = computeBackoff(attempt, options);
    if (retryAfterMs === null || retryAfterMs === undefined) return backoff;
    const { maxRetryAfterMs = 30_000 } = options;
    return Math.max(backoff, Math.min(retryAfterMs, maxRetryAfterMs));
}

/**
 * @typedef {object} RetryInfo
 * @property {number} attempt - 1-based number of the retry about to happen
 * @property {number} delayMs - How long we sleep before it
 * @property {any} error - The error that triggered it
 *
 * @typedef {BackoffOptions & {
 *   retries?: number,
 *   maxRetryAfterMs?: number,
 *   shouldRetry?: (error: any) => boolean,
 *   onRetry?: (info: RetryInfo) => void,
 *   sleep?: (ms: number) => Promise<void>
 * }} RetryOptions
 */

/**
 * Default retry predicate: only errors explicitly flagged `retryable`.
 * @param {any} error
 * @returns {boolean}
 */
export function isRetryable(error) {
    return Boolean(error && error.retryable);
}

/**
 * Run `fn` and retry it on retryable errors with backoff + jitter.
 * Errors may carry `retryAfterMs` (e.g. from a Retry-After header), which is honoured.
 * @template T
 * @param {(attempt: number) => Promise<T>} fn - Receives the 0-based attempt number
 * @param {RetryOptions} [options]
 * @returns {Promise<T>}
 */
export async function retry(fn, options = {}) {
    const {
        retries = 2,
        shouldRetry = isRetryable,
        onRetry,
        sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    } = options;

    for (let attempt = 0; ; attempt++) {
        try {
            return await fn(attempt);
        } catch (error) {
            if (attempt >= retries || !shouldRetry(error)) throw error;
            const delayMs = retryDelay(attempt, /** @type {any} */ (error)?.retryAfterMs ?? null, options);
            onRetry?.({ attempt: attempt + 1, delayMs, error });
            await sleep(delayMs);
        }
    }
}
