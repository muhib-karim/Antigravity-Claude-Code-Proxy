/**
 * Unit tests for upstream compatibility settings and their error mapping:
 * the Antigravity client version sent in the User-Agent (ANTIGRAVITY_VERSION), the
 * "no longer supported" upstream rejection, and connection failures to the Perplexity backend.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_ENV } from '../../tests/smoke/helpers.mjs';

// The defaults asserted below must not depend on the developer's shell or .env, so the settings
// are neutralised before src/constants.js is evaluated (static imports would run first)
Object.assign(process.env, NEUTRAL_ENV);
const {
    ANTIGRAVITY_HEADERS,
    ANTIGRAVITY_VERSION,
    DEFAULT_ANTIGRAVITY_VERSION,
    PERPLEXITY_SERVER_URL,
    buildUserAgent,
    joinUrl,
    resolveAntigravityVersion,
    resolveServerUrl
} = await import('../../src/constants.js');
const { mapError } = await import('../../src/http/error-mapper.js');
const { ApiError, BackendUnavailableError, connectionErrorCode, isUnsupportedClientVersion } =
    await import('../../src/errors.js');

const UNSUPPORTED = 'This version of Antigravity is no longer supported. Please update to receive the latest features!';

/** @returns {{warn: (msg: string) => void, messages: string[]}} */
function recorder() {
    const messages = [];
    return { warn: msg => messages.push(msg), messages };
}

describe('Antigravity client version', () => {
    it('defaults to the current stable Antigravity IDE release', () => {
        assert.equal(DEFAULT_ANTIGRAVITY_VERSION, '2.5.5');
        // The test environment does not set ANTIGRAVITY_VERSION
        assert.equal(ANTIGRAVITY_VERSION, '2.5.5');
        assert.match(ANTIGRAVITY_HEADERS['User-Agent'], /^antigravity\/2\.5\.5 [a-z0-9]+\/[a-z0-9_]+$/);
    });

    it('keeps the "antigravity/<version> <os>/<arch>" format', () => {
        assert.equal(buildUserAgent('2.6.0', 'darwin', 'arm64'), 'antigravity/2.6.0 darwin/arm64');
        assert.equal(buildUserAgent('1.2.3', 'win32', 'x64'), 'antigravity/1.2.3 win32/x64');
    });

    it('accepts dotted numeric x.y.z versions (surrounding whitespace ignored)', () => {
        const log = recorder();
        assert.equal(resolveAntigravityVersion('2.6.1', log.warn), '2.6.1');
        assert.equal(resolveAntigravityVersion(' 10.0.12 ', log.warn), '10.0.12');
        assert.deepEqual(log.messages, []);
    });

    it('uses the default without a warning when unset or empty', () => {
        const log = recorder();
        assert.equal(resolveAntigravityVersion(undefined, log.warn), '2.5.5');
        assert.equal(resolveAntigravityVersion('', log.warn), '2.5.5');
        assert.deepEqual(log.messages, []);
    });

    for (const bad of ['2.5', 'v2.5.5', '2.5.5-beta', '2.5.x', '1.2.3.4', 'latest', '2.5.5 linux/x64']) {
        it(`falls back to the default and warns for ${JSON.stringify(bad)}`, () => {
            const log = recorder();
            assert.equal(resolveAntigravityVersion(bad, log.warn), '2.5.5');
            assert.equal(log.messages.length, 1);
            assert.match(log.messages[0], /ANTIGRAVITY_VERSION/);
            assert.match(log.messages[0], /2\.5\.5/);
        });
    }
});

describe('Perplexity backend URL', () => {
    it('defaults to http://localhost:8000', () => {
        assert.equal(PERPLEXITY_SERVER_URL, 'http://localhost:8000');
    });

    it('strips trailing slashes and falls back (with a warning) on values that are not http(s) URLs', () => {
        const log = recorder();
        assert.equal(resolveServerUrl('http://127.0.0.1:9000/', 'X', 'http://d', log.warn), 'http://127.0.0.1:9000');
        assert.equal(
            resolveServerUrl('https://pplx.internal/base//', 'X', 'http://d', log.warn),
            'https://pplx.internal/base'
        );
        assert.equal(resolveServerUrl(undefined, 'X', 'http://d', log.warn), 'http://d');
        assert.deepEqual(log.messages, []);
        assert.equal(resolveServerUrl('localhost:8000', 'X', 'http://d', log.warn), 'http://d');
        assert.equal(resolveServerUrl('ftp://host', 'X', 'http://d', log.warn), 'http://d');
        assert.equal(log.messages.length, 2);
        assert.match(log.messages[0], /X/);
    });

    it('returns a normalized origin + path', () => {
        const log = recorder();
        assert.equal(
            resolveServerUrl('HTTP://PPLX.Internal:8000/base/', 'X', 'http://d', log.warn),
            'http://pplx.internal:8000/base'
        );
        assert.equal(resolveServerUrl('https://pplx.internal:443', 'X', 'http://d', log.warn), 'https://pplx.internal');
        assert.equal(resolveServerUrl('http://h:1/a/../b', 'X', 'http://d', log.warn), 'http://h:1/b');
        assert.deepEqual(log.messages, []);
    });

    for (const bad of [
        'http://127.0.0.1:8000?token=abc',
        'http://127.0.0.1:8000/base?x=1',
        'http://127.0.0.1:8000/#frag',
        'http://127.0.0.1:8000/base#',
        'http://127.0.0.1:8000/?'
    ]) {
        it(`rejects a query string or fragment: ${bad}`, () => {
            const log = recorder();
            assert.equal(resolveServerUrl(bad, 'PERPLEXITY_SERVER_URL', 'http://d', log.warn), 'http://d');
            assert.equal(log.messages.length, 1);
            assert.match(log.messages[0], /PERPLEXITY_SERVER_URL .*query string or fragment; using http:\/\/d/);
        });
    }

    for (const withCredentials of [
        'http://alice:hunter2@127.0.0.1:8000',
        'https://alice:hunter2@pplx.internal/base/',
        'http://:hunter2@127.0.0.1:8000',
        'http://hunter2@127.0.0.1:8000'
    ]) {
        it(`rejects credentials without showing them: ${withCredentials.replace(/\/\/.*@/, '//…@')}`, () => {
            const log = recorder();
            const resolved = resolveServerUrl(withCredentials, 'PERPLEXITY_SERVER_URL', 'http://d', log.warn);
            assert.equal(resolved, 'http://d');
            assert.equal(log.messages.length, 1);
            assert.ok(!log.messages[0].includes('hunter2'), log.messages[0]);
            assert.ok(!log.messages[0].includes('alice'), log.messages[0]);
            assert.match(log.messages[0], /"https?:\/\/\*\*\*@[^"]+" must not contain credentials/);
        });
    }

    for (const invalid of [
        'http://alice:hunter2@pplx.internal:99999',
        'ftp://alice:hunter2@pplx.internal',
        'alice:hunter2@pplx.internal',
        'http://alice:hun/ter2@pplx.internal'
    ]) {
        it(`never shows credentials of an invalid value: ${invalid.replace(/hun\/?ter2/, '…')}`, () => {
            const log = recorder();
            assert.equal(resolveServerUrl(invalid, 'PERPLEXITY_SERVER_URL', 'http://d', log.warn), 'http://d');
            assert.equal(log.messages.length, 1);
            assert.ok(!/hunter2|hun\/ter2|ter2|alice/.test(log.messages[0]), log.messages[0]);
            assert.match(log.messages[0], /\*\*\*@pplx\.internal/);
        });
    }

    it('joins a base and a path with exactly one slash', () => {
        assert.equal(joinUrl('http://h:1', '/stats'), 'http://h:1/stats');
        assert.equal(joinUrl('http://h:1/base', '/v1/chat/completions'), 'http://h:1/base/v1/chat/completions');
        assert.equal(joinUrl('http://h:1/base/', 'stats'), 'http://h:1/base/stats');
    });
});

describe('"no longer supported" upstream rejection', () => {
    it('recognises the upstream message only on errors that carry an upstream status', () => {
        assert.equal(isUnsupportedClientVersion(new ApiError(`API error 400: ${UNSUPPORTED}`, 400)), true);
        assert.equal(isUnsupportedClientVersion(new ApiError('API error 400: bad request', 400)), false);
        assert.equal(isUnsupportedClientVersion(new Error(UNSUPPORTED)), false);
        assert.equal(isUnsupportedClientVersion(null), false);
    });

    for (const status of [400, 403, 426, 500]) {
        it(`maps an upstream ${status} with that text to 400 invalid_request_error with the version hint`, () => {
            const body = JSON.stringify({
                error: { code: status, message: UNSUPPORTED, status: 'FAILED_PRECONDITION' }
            });
            const mapped = mapError(new ApiError(`API error ${status}: ${body}`, status));
            assert.equal(mapped.status, 400);
            assert.equal(mapped.type, 'invalid_request_error');
            assert.match(mapped.message, /no longer supported/);
            assert.match(mapped.message, /antigravity\/2\.5\.5/);
            assert.match(mapped.message, /ANTIGRAVITY_VERSION/);
            assert.match(mapped.message, /update the proxy/);
        });
    }

    // Whether the request is retried is covered end to end in test/integration/upstream-compat.test.mjs
    it('maps the rejection to 400 whether or not the error is marked retryable', () => {
        const asSent = new ApiError(`API error 500: ${UNSUPPORTED}`, 500);
        assert.equal(asSent.retryable, true);
        assert.equal(mapError(asSent).status, 400);
        const final = Object.assign(new ApiError(`API error 500: ${UNSUPPORTED}`, 500), { retryable: false });
        assert.equal(mapError(final).status, 400);
    });
});

describe('Perplexity backend connection failures', () => {
    const fetchFailed = cause => Object.assign(new TypeError('fetch failed'), { cause });

    it('finds the connection error code on the error, its cause, or inside an AggregateError', () => {
        assert.equal(
            connectionErrorCode(fetchFailed(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))),
            'ECONNREFUSED'
        );
        assert.equal(connectionErrorCode(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), 'ENOTFOUND');
        assert.equal(
            connectionErrorCode(fetchFailed(Object.assign(new Error('x'), { code: 'UND_ERR_CONNECT_TIMEOUT' }))),
            'UND_ERR_CONNECT_TIMEOUT'
        );
        // localhost resolves to ::1 and 127.0.0.1; Node reports both refusals in an AggregateError
        const both = new AggregateError([
            Object.assign(new Error('a'), { code: 'ECONNREFUSED' }),
            Object.assign(new Error('b'), { code: 'ECONNREFUSED' })
        ]);
        assert.equal(connectionErrorCode(fetchFailed(both)), 'ECONNREFUSED');
        assert.equal(
            connectionErrorCode(new AggregateError([Object.assign(new Error('c'), { code: 'EHOSTUNREACH' })])),
            'EHOSTUNREACH'
        );
        assert.equal(
            connectionErrorCode(fetchFailed(Object.assign(new Error('x'), { code: 'ECONNRESET' }))),
            'ECONNRESET'
        );
    });

    it('ignores errors that are not connection failures', () => {
        assert.equal(connectionErrorCode(new Error('boom')), null);
        assert.equal(connectionErrorCode(Object.assign(new Error('x'), { code: 'ERR_INVALID_URL' })), null);
        assert.equal(connectionErrorCode(fetchFailed(new Error('no code'))), null);
        assert.equal(connectionErrorCode(undefined), null);
    });

    it('maps an unreachable backend to 503 api_error with the URL and how to fix it', () => {
        const err = new BackendUnavailableError('Perplexity', 'http://127.0.0.1:9', 'ECONNREFUSED');
        assert.equal(err.code, 'ECONNREFUSED');
        const mapped = mapError(err);
        assert.equal(mapped.status, 503);
        assert.equal(mapped.type, 'api_error');
        assert.equal(
            mapped.message,
            'Perplexity backend is not reachable at http://127.0.0.1:9 (ECONNREFUSED). Perplexity models need the ' +
                'separate Perplexity server running; start it or set PERPLEXITY_SERVER_URL. ' +
                'Gemini and Claude models are unaffected.'
        );
    });

    it('never shows credentials embedded in the backend URL', () => {
        const err = new BackendUnavailableError(
            'Perplexity',
            'http://user:hunter2@pplx.internal:8000/base',
            'ENOTFOUND'
        );
        const { message } = mapError(err);
        assert.ok(!message.includes('hunter2') && !message.includes('user:'), message);
        assert.match(message, /http:\/\/pplx\.internal:8000\/base/);
    });

    it('keeps sensible statuses for HTTP errors from the backend', () => {
        assert.deepEqual(
            [500, 502, 400, 404].map(s => mapError(new ApiError(`Perplexity backend error ${s}: x`, s)).status),
            [502, 502, 400, 404]
        );
        const limited = mapError(new ApiError('Perplexity backend error 429: slow down', 429, 'api_error', 7000), {
            rateLimitStatus: 429
        });
        assert.equal(limited.status, 429);
        assert.equal(limited.type, 'rate_limit_error');
        assert.equal(limited.retryAfterSeconds, 7);
    });

    it('maps a backend 429 to 400 invalid_request_error by default (RATE_LIMIT_STATUS unset)', () => {
        const mapped = mapError(new ApiError('Perplexity backend error 429: slow down', 429, 'api_error', 7000));
        assert.equal(mapped.status, 400);
        assert.equal(mapped.type, 'invalid_request_error');
        assert.equal(mapped.retryAfterSeconds, 7);
    });

    for (const status of [503, 529]) {
        it(`maps a backend ${status} to 529 overloaded_error (not 502)`, () => {
            const mapped = mapError(
                new ApiError(`Perplexity backend error ${status}: busy`, status, 'api_error', 3000)
            );
            assert.equal(mapped.status, 529);
            assert.equal(mapped.type, 'overloaded_error');
            assert.equal(mapped.retryAfterSeconds, 3);
        });
    }

    it('never returns credentials that an unexpected error quotes from the backend URL', () => {
        const err = new TypeError(
            'Request cannot be constructed from a URL that includes credentials: http://alice:hunter2@pplx.internal:8000/v1'
        );
        const { status, message } = mapError(err);
        assert.equal(status, 500);
        assert.ok(!message.includes('hunter2') && !message.includes('alice'), message);
        assert.match(message, /http:\/\/\*\*\*@pplx\.internal:8000\/v1/);
    });
});
