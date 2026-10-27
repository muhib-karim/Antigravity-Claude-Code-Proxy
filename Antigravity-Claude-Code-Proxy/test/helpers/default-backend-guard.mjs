/**
 * Preloaded with --import into every proxy the tests spawn (see DEFAULT_BACKEND_GUARD_ENV in
 * tests/smoke/helpers.mjs). Requests to the default Perplexity backend (port 8000 on a loopback
 * host) fail like a refused connection and are reported on stderr, so a test that falls back to
 * the default never reaches a backend a developer may be running locally, and never hangs on it.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const realFetch = globalThis.fetch;

/** @type {typeof fetch} */
globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (LOOPBACK.has(url.hostname) && url.port === '8000') {
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        process.stderr.write(`[default-backend-guard] blocked ${method} ${url.pathname}\n`);
        const refused = Object.assign(new Error(`connect ECONNREFUSED ${url.host}`), { code: 'ECONNREFUSED' });
        throw new TypeError('fetch failed', { cause: refused });
    }
    return realFetch(input, init);
};
