/**
 * Unit tests for upstream compatibility settings and their error mapping:
 * the Antigravity client version sent in the User-Agent (ANTIGRAVITY_VERSION), the
 * "no longer supported" upstream rejection, and connection failures to the Perplexity backend.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
        assert.match(log.messages[0], /^\[Config\] X rejected: /);
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

    /**
     * The exact warning for a rejected value: it names the rule that failed and the default used,
     * and never repeats the value (not even masked), so nothing of a password can reach a log.
     * @param {string} problem
     */
    const rejection = problem =>
        `[Config] PERPLEXITY_SERVER_URL rejected: ${problem}; using the default http://d (the value is not shown)`;

    /** @type {Array<[string, string]>} rejected value -> rule reported */
    const rejected = [
        ['http://127.0.0.1:8000?token=abc', 'it has a query string or fragment'],
        ['http://127.0.0.1:8000/base?x=1', 'it has a query string or fragment'],
        ['http://127.0.0.1:8000/#frag', 'it has a query string or fragment'],
        ['http://127.0.0.1:8000/base#', 'it has a query string or fragment'],
        ['http://127.0.0.1:8000/?', 'it has a query string or fragment'],
        ['http://alice:hunter2@127.0.0.1:8000', 'it has credentials (user:password@)'],
        ['https://alice:hunter2@pplx.internal/base/', 'it has credentials (user:password@)'],
        ['http://:hunter2@127.0.0.1:8000', 'it has credentials (user:password@)'],
        ['http://hunter2@127.0.0.1:8000', 'it has credentials (user:password@)'],
        // the reported leak: a quote and a second "@" inside the password
        ['http://alice:pass@word"tail@host:8000', 'it has credentials (user:password@)'],
        ['http://alice:p%40ss@host:8000', 'it has credentials (user:password@)'],
        ['http://alice:hun ter2@host', 'it has credentials (user:password@)'],
        ['ftp://alice:hunter2@pplx.internal', 'it is not an http(s) URL'],
        ['ftp://host', 'it is not an http(s) URL'],
        ['localhost:8000', 'it is not an http(s) URL'],
        ['http://alice:hunter2@pplx.internal:99999', 'it cannot be parsed as a URL'],
        // parses as a URL with the scheme "alice:"
        ['alice:hunter2@pplx.internal', 'it is not an http(s) URL'],
        ['http://alice:hun/ter2@pplx.internal', 'it cannot be parsed as a URL'],
        ['http://alice:pass@word"tail@host:99999', 'it cannot be parsed as a URL']
    ];

    for (const [value, problem] of rejected) {
        it(`rejects a value because ${problem}, without showing it: ${value.replace(/[^/]*@/, '…@')}`, () => {
            const log = recorder();
            assert.equal(resolveServerUrl(value, 'PERPLEXITY_SERVER_URL', 'http://d', log.warn), 'http://d');
            assert.deepEqual(log.messages, [rejection(problem)]);
        });
    }

    it('warns through console.warn by default, without the rejected value', t => {
        const warn = t.mock.method(console, 'warn', () => {});
        const value = 'http://alice:pass@word"tail@host:8000';
        assert.equal(resolveServerUrl(value, 'PERPLEXITY_SERVER_URL', 'http://d'), 'http://d');
        assert.equal(warn.mock.callCount(), 1);
        assert.deepEqual(warn.mock.calls[0].arguments, [rejection('it has credentials (user:password@)')]);
    });

    it('prints nothing of a rejected PERPLEXITY_SERVER_URL when the setting is read at startup', () => {
        // Same shape as the reported leak, with fragments that cannot occur in the warning text
        const value = 'http://alice:s3cr3t@qq"zz@host:8000';
        const constants = new URL('../../src/constants.js', import.meta.url).href;
        const result = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `const c = await import(${JSON.stringify(constants)}); console.log(c.PERPLEXITY_SERVER_URL);`
            ],
            { env: { ...process.env, ...NEUTRAL_ENV, PERPLEXITY_SERVER_URL: value }, encoding: 'utf8', timeout: 30_000 }
        );
        assert.equal(result.status, 0, result.stderr);
        const output = `${result.stdout}\n${result.stderr}`;
        for (const secret of ['alice', 's3cr3t', 'qq', 'zz', '***']) {
            assert.ok(!output.includes(secret), `"${secret}" printed in:\n${output}`);
        }
        assert.match(
            output,
            /PERPLEXITY_SERVER_URL rejected: it has credentials \(user:password@\); using the default/
        );
        assert.equal(result.stdout.trim().split('\n').at(-1), 'http://localhost:8000');
    });

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
