/**
 * Integration tests for the management endpoints used by the dashboard and status bar:
 * account limits (JSON and table), session models, usage stats, OAuth status, token
 * counting and token refresh. Runs the real proxy against the smoke mock upstream.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockUpstream, startProxy, FAKE_ACCESS_TOKEN, FAKE_PROJECT_ID } from '../../tests/smoke/helpers.mjs';

const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
});

describe('management endpoints', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startMockUpstream();
        proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [
                { email: 'mock-account', source: 'manual', apiKey: FAKE_ACCESS_TOKEN, projectId: FAKE_PROJECT_ID },
                { email: 'revoked-account', source: 'manual', apiKey: 'x', isInvalid: true, invalidReason: 'revoked' }
            ]
        });
    });

    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('GET /account-limits returns per-account model quotas as JSON', async () => {
        const res = await fetch(`${proxy.baseUrl}/account-limits`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.totalAccounts, 2);
        assert.deepEqual(body.models, ['gemini-3-flash', 'gemini-3-pro-high']);
        const ok = body.accounts.find(a => a.email === 'mock-account');
        assert.equal(ok.status, 'ok');
        assert.ok(ok.limits['gemini-3-pro-high'], 'quota for gemini-3-pro-high');
        const revoked = body.accounts.find(a => a.email === 'revoked-account');
        assert.equal(revoked.status, 'invalid');
        assert.equal(revoked.error, 'revoked');
    });

    it('GET /account-limits?format=table renders a plain-text table', async () => {
        const res = await fetch(`${proxy.baseUrl}/account-limits?format=table`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /^text\/plain/);
        const text = await res.text();
        assert.match(text, /mock-account/);
        assert.match(text, /gemini-3-pro-high/);
    });

    it('session models can be set, listed, read and deleted', async () => {
        const id = 'mgmt-session-1';
        const missing = await (await fetch(`${proxy.baseUrl}/session-model/${id}`)).json();
        assert.equal(missing.isDefault, true);

        const set = await fetch(
            `${proxy.baseUrl}/session-model`,
            json('POST', { sessionId: id, model: 'gemini-3-pro-high', name: 'demo' })
        );
        assert.equal(set.status, 200);
        const got = await (await fetch(`${proxy.baseUrl}/session-model/${id}`)).json();
        assert.equal(got.model, 'gemini-3-pro-high');
        assert.equal(got.name, 'demo');

        const list = await (await fetch(`${proxy.baseUrl}/sessions`)).json();
        assert.ok(list.count >= 1);
        assert.ok(list.sessions.some(s => s.sessionId === id));

        const del = await fetch(`${proxy.baseUrl}/session-model/${id}`, { method: 'DELETE' });
        assert.equal(del.status, 200);
        const after = await (await fetch(`${proxy.baseUrl}/session-model/${id}`)).json();
        assert.equal(after.isDefault, true);
    });

    it('rejects an invalid session model', async () => {
        const res = await fetch(`${proxy.baseUrl}/session-model`, json('POST', { sessionId: 's', model: '' }));
        assert.equal(res.status, 400);
    });

    it('GET /model-usage reports usage after a request', async () => {
        const msg = await fetch(
            `${proxy.baseUrl}/v1/messages`,
            json('POST', { model: 'gemini-3-flash', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] })
        );
        assert.equal(msg.status, 200);
        const usage = await (await fetch(`${proxy.baseUrl}/model-usage`)).json();
        assert.match(JSON.stringify(usage), /gemini-3-flash/);
    });

    it('GET /oauth/status reports no flow in progress and DELETE /oauth/cancel is idempotent', async () => {
        const status = await (await fetch(`${proxy.baseUrl}/oauth/status`)).json();
        assert.equal(status.inProgress, false);
        const cancel = await fetch(`${proxy.baseUrl}/oauth/cancel`, { method: 'DELETE' });
        assert.equal(cancel.status, 200);
    });

    it('POST /v1/messages/count_tokens is explicitly unsupported', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages/count_tokens`, json('POST', {}));
        assert.equal(res.status, 501);
        assert.equal((await res.json()).type, 'error');
    });

    it('POST /refresh-token fails cleanly without a local Antigravity install', async () => {
        const res = await fetch(`${proxy.baseUrl}/refresh-token`, json('POST', {}));
        assert.equal(res.status, 500);
        assert.equal((await res.json()).status, 'error');
    });

    it('GET /perplexity-sessions lists no sessions by default', async () => {
        const res = await fetch(`${proxy.baseUrl}/perplexity-sessions`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(JSON.stringify(body).includes('@'), false);
    });
});
