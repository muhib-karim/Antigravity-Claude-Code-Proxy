/**
 * Unit tests for helmet-style security headers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { securityHeaders, API_CSP, DASHBOARD_CSP } from '../../src/http/security.js';

function run(path) {
    const headers = {};
    const res = {
        setHeader: (k, v) => (headers[k.toLowerCase()] = v),
        removeHeader: k => delete headers[k.toLowerCase()]
    };
    let next = false;
    securityHeaders({ path }, res, () => (next = true));
    assert.ok(next);
    return headers;
}

describe('securityHeaders', () => {
    it('sets the baseline headers on API responses', () => {
        const h = run('/v1/messages');
        assert.equal(h['x-content-type-options'], 'nosniff');
        assert.equal(h['referrer-policy'], 'no-referrer');
        assert.equal(h['cross-origin-opener-policy'], 'same-origin');
        assert.equal(h['cross-origin-resource-policy'], 'same-origin');
        assert.equal(h['x-frame-options'], 'DENY');
        assert.equal(h['content-security-policy'], API_CSP);
        assert.match(API_CSP, /default-src 'none'/);
    });

    it('uses a dashboard CSP that still forbids framing by other sites', () => {
        for (const path of ['/dashboard', '/dashboard.html', '/']) {
            const h = run(path);
            assert.equal(h['content-security-policy'], DASHBOARD_CSP, path);
            assert.equal(h['x-frame-options'], undefined, path);
        }
        assert.match(DASHBOARD_CSP, /frame-ancestors 'self' vscode-webview:/);
        assert.match(DASHBOARD_CSP, /object-src 'none'/);
        assert.match(DASHBOARD_CSP, /connect-src 'self'/);
    });
});
