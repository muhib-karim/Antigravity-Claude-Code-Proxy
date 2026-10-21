/**
 * Unit tests for secret redaction used by logging and error messages.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactString, installConsoleRedaction } from '../../src/utils/redact.js';

// Key-shaped values are assembled at runtime so no credential-looking literal sits in the source
// (secret scanners would flag it). These are synthetic and grant access to nothing.
const FAKE_GOOGLE_KEY = 'AIza' + 'Sy' + 'x'.repeat(33);
const FAKE_ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'synthetic0000000'].join('-');

describe('redactString', () => {
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

    it('masks JSON-style secret fields', () => {
        const out = redactString('{"access_token":"tok123","refreshToken":"r456","client_secret":"s789","name":"x"}');
        assert.ok(!/tok123|r456|s789/.test(out), out);
        assert.match(out, /"name":"x"/);
    });

    it('leaves ordinary text untouched', () => {
        assert.equal(redactString('Hello from the mock upstream'), 'Hello from the mock upstream');
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
