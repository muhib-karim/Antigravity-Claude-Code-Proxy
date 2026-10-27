/**
 * Unit tests for secret redaction used by logging and error messages.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    URL_PLACEHOLDER,
    installConsoleRedaction,
    redact,
    redactString,
    redactUrl,
    redactUrlCredentials
} from '../../src/utils/redact.js';

// Key-shaped values are assembled at runtime so no credential-looking literal sits in the source
// (secret scanners would flag it). These are synthetic and grant access to nothing.
const FAKE_GOOGLE_KEY = 'AIza' + 'Sy' + 'x'.repeat(33);
const FAKE_ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'synthetic0000000'].join('-');

describe('redactString', () => {
    it('replaces credentials embedded in URLs with ***', () => {
        const cases = [
            ['http://alice:hunter2@host:8000/v1', 'http://***@host:8000/v1'],
            ['fetch https://alice:hunter2@pplx.internal failed', 'fetch https://***@pplx.internal failed'],
            ['postgres://svc:hunter2@db/x', 'postgres://***@db/x'],
            ['token-only http://hunter2@host', 'token-only http://***@host'],
            // unencoded "@" inside the password: the userinfo ends at the last "@" of the authority
            ['http://alice:hun@ter2@host/p?mail=a@b.test', 'http://***@host/p?mail=a@b.test'],
            ['"url":"http://alice:hunter2@host:99999"', '"url":"http://***@host:99999"']
        ];
        for (const [input, expected] of cases) {
            assert.equal(redactString(input), expected);
            assert.equal(redactUrlCredentials(input), expected);
        }
    });

    it('leaves URLs without credentials and plain e-mail addresses alone', () => {
        for (const text of ['http://host:8000/base?x=1', 'mail alice@example.test', 'see https://h.test/a@b']) {
            assert.equal(redactUrlCredentials(text), text);
        }
    });

    // The authority ends at the first "/", "?", "#" or "\" (WHATWG; "\" counts as "/" for http(s));
    // the userinfo is everything up to the last "@" inside it, whatever characters it contains
    it('masks up to the last "@" of the authority, even with several "@" or quotes in the password', () => {
        const cases = [
            ['http://alice:pass@word"tail@host:8000', 'http://***@host:8000'],
            ['http://a:b@c@d@host:1/x', 'http://***@host:1/x'],
            ["http://alice:it's@secret@host/p", 'http://***@host/p'],
            ['http://alice:<pw>@x@host', 'http://***@host'],
            ['log "http://alice:pass@word"tail@host:8000" end', 'log "http://***@host:8000" end'],
            ['http://alice:pass@word"tail@host:8000\\a@b', 'http://***@host:8000\\a@b'],
            ['http:\\\\alice:pass@host/', 'http:\\\\***@host/']
        ];
        for (const [input, expected] of cases) {
            assert.equal(redactUrlCredentials(input), expected);
            assert.equal(redactString(input), expected);
            for (const secret of ['alice', 'pass', 'word', 'tail', 'secret', 'pw']) {
                assert.ok(!redactString(input).includes(secret), `${secret} leaked from ${input}`);
            }
        }
    });

    it('treats a percent-encoded "@" (%40) as part of the userinfo, not as its end', () => {
        assert.equal(redactUrlCredentials('http://alice:p%40ss@host/'), 'http://***@host/');
        assert.equal(redactUrlCredentials('http://alice%40corp:pw@host'), 'http://***@host');
        // no real "@": there is no userinfo to mask
        assert.equal(redactUrlCredentials('http://host%40x/'), 'http://host%40x/');
    });

    it('never treats an "@" in the path, query or fragment as userinfo', () => {
        for (const text of [
            'http://host/a@b',
            'http://host:8000/users/alice@example.test',
            'http://host?mail=a@b',
            'http://host#a@b',
            'http://host\\a@b',
            'https://h.test/p?q=1#x@y'
        ]) {
            assert.equal(redactUrlCredentials(text), text);
            assert.equal(redactString(text), text);
        }
        assert.equal(redactUrlCredentials('http://u:p@host/a@b?c=d@e#f@g'), 'http://***@host/a@b?c=d@e#f@g');
    });
    it('masks bearer tokens, Google access/refresh tokens and API keys', () => {
        const input = [
            'Authorization: Bearer abc.def-123',
            'token ya29.A0ARrdaM-secret_value',
            'refresh 1//0gSecretRefreshToken-xyz',
            `key ${FAKE_GOOGLE_KEY}`,
            `anthropic ${FAKE_ANTHROPIC_KEY}`
        ].join('\n');
        const out = redactString(input);
        for (const secret of [
            'abc.def-123',
            'ya29.A0ARrdaM-secret_value',
            '1//0gSecretRefreshToken-xyz',
            FAKE_GOOGLE_KEY,
            FAKE_ANTHROPIC_KEY
        ]) {
            assert.ok(!out.includes(secret), `leaked ${secret} in ${out}`);
        }
        assert.match(out, /\[REDACTED\]/);
    });

    it('masks Perplexity keys, JWT session tokens, session cookies and OAuth client secrets', () => {
        const pplx = ['pplx', 'synthetic0key0value0000000000'].join('-');
        const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzeW50aGV0aWMifQ', 'c2lnbmF0dXJlMDAwMA'].join('.');
        const clientSecret = ['GOCSPX', 'synthetic0secret0000000'].join('-');
        const input = [
            `perplexity key ${pplx}`,
            `bare jwt ${jwt}`,
            `Cookie: __Secure-next-auth.session-token=opaque0cookie0value; theme=dark`,
            `secret ${clientSecret}`
        ].join('\n');
        const out = redactString(input);
        for (const secret of [pplx, jwt, 'opaque0cookie0value', clientSecret]) {
            assert.ok(!out.includes(secret), `leaked ${secret} in ${out}`);
        }
        assert.match(out, /theme=dark/, 'non-secret cookies are kept');
    });

    it('masks JSON-style secret fields', () => {
        const out = redactString('{"access_token":"tok123","refreshToken":"r456","client_secret":"s789","name":"x"}');
        assert.ok(!/tok123|r456|s789/.test(out), out);
        assert.match(out, /"name":"x"/);
    });

    it('leaves ordinary text untouched', () => {
        assert.equal(redactString('Hello from the mock upstream'), 'Hello from the mock upstream');
        assert.equal(redactString('max_tokens=200000 exceeds the limit'), 'max_tokens=200000 exceeds the limit');
    });
});

describe('redactUrl (a single URL value)', () => {
    it('masks the userinfo of a parseable URL and keeps the rest', () => {
        assert.equal(
            redactUrl('http://pplx.internal:8000/v1/chat/completions'),
            'http://pplx.internal:8000/v1/chat/completions'
        );
        assert.equal(redactUrl('http://alice:pass@word"tail@host:8000/v1'), 'http://***@host:8000/v1');
        assert.equal(redactUrl('http://alice:p%40ss@host/x?y=a@b'), 'http://***@host/x?y=a@b');
    });

    it('replaces the whole value with a placeholder when it cannot be parsed safely', () => {
        for (const value of [
            'not a url',
            'http://alice:hunter2@pplx.internal:99999',
            // the URL parser sees credentials that text masking cannot delimit
            'http://alice:hun ter2@host',
            'http:alice:hunter2@host',
            'http:/alice:hunter2@host',
            ''
        ]) {
            assert.equal(redactUrl(value), URL_PLACEHOLDER, value);
        }
    });
});

describe('redactString performance', () => {
    it('stays linear on long unbroken input', () => {
        for (const text of [
            'a'.repeat(100_000),
            'session'.repeat(20_000),
            'eyJ' + 'x'.repeat(100_000),
            'http://' + '@'.repeat(100_000),
            'a://'.repeat(25_000),
            'http://' + 'a@'.repeat(50_000) + '/'
        ]) {
            const started = process.hrtime.bigint();
            redactString(text);
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            assert.ok(ms < 500, `took ${ms.toFixed(1)}ms`);
        }
    });
});

describe('redact', () => {
    it('deep-redacts sensitive keys in objects without mutating the input', () => {
        const input = { email: 'a@b', apiKey: 'k', nested: { Authorization: 'Bearer z', list: [{ password: 'p' }] } };
        const out = redact(input);
        assert.equal(out.apiKey, '[REDACTED]');
        assert.equal(out.nested.Authorization, '[REDACTED]');
        assert.equal(out.nested.list[0].password, '[REDACTED]');
        assert.equal(out.email, 'a@b');
        assert.equal(input.apiKey, 'k');
    });

    it('handles errors, cycles and primitives', () => {
        const cyclic = { token: 't' };
        cyclic.self = cyclic;
        const out = redact(cyclic);
        assert.equal(out.token, '[REDACTED]');
        assert.equal(out.self, '[Circular]');
        const err = redact(new Error('failed with Bearer secret-token'));
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes('secret-token'));
        assert.equal(redact(42), 42);
        assert.equal(redact(null), null);
    });
});

describe('installConsoleRedaction', () => {
    it('redacts strings and objects passed to console methods and can be undone', () => {
        const lines = [];
        const sink = { log: (...a) => lines.push(a), error: (...a) => lines.push(a), warn: (...a) => lines.push(a) };
        const uninstall = installConsoleRedaction(sink);
        sink.log('token=Bearer leaked-value', { refresh_token: 'r' });
        sink.error(new Error('Bearer another-leak'));
        uninstall();
        sink.log('Bearer after-uninstall');
        const flat = JSON.stringify(lines.slice(0, 2).map(a => a.map(x => (x instanceof Error ? x.message : x))));
        assert.ok(!/leaked-value|another-leak|"r"/.test(flat), flat);
        assert.equal(lines[2][0], 'Bearer after-uninstall');
    });
});
