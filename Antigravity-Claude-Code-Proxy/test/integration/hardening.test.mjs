/**
 * Integration tests for hardening and operability: secret redaction in logs, health and
 * Prometheus endpoints, security headers, rate limiting and graceful shutdown.
 * The real proxy process runs against a scripted mock upstream.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startProxy, FAKE_PROJECT_ID } from '../../tests/smoke/helpers.mjs';
import { startScriptedUpstream } from '../helpers/scripted-upstream.mjs';
import { parseSse } from '../helpers/match.mjs';

const ACCOUNT_TOKEN = 'ya29.account-secret-token-0001';
// Key-shaped values are assembled at runtime so no credential-looking literal sits in the source
// (secret scanners would flag it). All of these are synthetic.
const FAKE_GOOGLE_KEY = 'AIza' + 'Sy' + 'u'.repeat(33);
const FAKE_CLIENT_KEY = ['sk', 'ant', 'api03', 'syntheticclient0'].join('-');
const account = { email: 'mock-account', source: 'manual', apiKey: ACCOUNT_TOKEN, projectId: FAKE_PROJECT_ID };
const FAST_RETRIES = { UPSTREAM_RETRIES: '1', RETRY_BASE_MS: '5', RETRY_MAX_MS: '10' };

const message = (extra = {}) => ({
    model: 'gemini-3-flash',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say hello' }],
    ...extra
});

const textChunk = (text, finish) => ({
    response: {
        candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finish ? { finishReason: finish } : {}) }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }
    }
});

describe('secret redaction', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startScriptedUpstream();
        proxy = await startProxy({ upstreamUrl: upstream.url, accounts: [account], env: FAST_RETRIES });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('never writes account tokens, client credentials or upstream-echoed secrets to logs or responses', async () => {
        const leaky = {
            error: {
                code: 500,
                message: `backend failed for Bearer ${ACCOUNT_TOKEN} refresh 1//0gUpstreamRefreshSecret99 key ${FAKE_GOOGLE_KEY}`
            }
        };
        upstream.enqueue({ status: 500, json: leaky }, { status: 500, json: leaky });
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: 'Bearer client-secret-abc123',
                'x-api-key': FAKE_CLIENT_KEY
            },
            body: JSON.stringify(message())
        });
        const body = await res.text();
        assert.equal(res.status, 502);

        // The upstream still receives the real account token (redaction is display-only)
        assert.equal(upstream.requests[0].headers.authorization, `Bearer ${ACCOUNT_TOKEN}`);

        const logFile = join(proxy.stateDir, 'logs', 'proxy.log');
        const everything = [proxy.logs(), body, existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''].join('\n');
        assert.match(proxy.logs(), /backend failed/, 'the upstream error itself should still be logged');
        for (const secret of [
            ACCOUNT_TOKEN,
            '1//0gUpstreamRefreshSecret99',
            FAKE_GOOGLE_KEY,
            'client-secret-abc123',
            FAKE_CLIENT_KEY
        ]) {
            assert.ok(!everything.includes(secret), `secret ${secret} leaked`);
        }
        assert.match(proxy.logs(), /\[REDACTED\]/);
    });
});

describe('health, readiness and metrics', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startScriptedUpstream();
        proxy = await startProxy({ upstreamUrl: upstream.url, accounts: [account], env: FAST_RETRIES });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('GET /livez answers without touching accounts', async () => {
        const res = await fetch(`${proxy.baseUrl}/livez`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { status: 'ok' });
    });

    it('GET /readyz is ready with an available account', async () => {
        const res = await fetch(`${proxy.baseUrl}/readyz`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { status: 'ready', available: 1 });
    });

    it('GET /metrics exposes request, retry and account metrics in Prometheus text format', async () => {
        upstream.enqueue({ status: 500, json: { error: { message: 'blip' } } });
        const ok = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message())
        });
        assert.equal(ok.status, 200);
        await fetch(`${proxy.baseUrl}/no/such/path/42`);

        const res = await fetch(`${proxy.baseUrl}/metrics`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /^text\/plain; version=0\.0\.4/);
        const text = await res.text();
        assert.match(text, /^# TYPE proxy_http_requests_total counter$/m);
        assert.match(text, /^proxy_http_requests_total\{method="POST",route="\/v1\/messages",status="200"\} 1$/m);
        assert.match(text, /^proxy_http_requests_total\{method="GET",route="unmatched",status="404"\} 1$/m);
        assert.match(text, /^proxy_http_request_duration_seconds_count\{method="POST",route="\/v1\/messages"\} 1$/m);
        assert.match(text, /^proxy_upstream_retries_total\{reason="500"\} 1$/m);
        assert.match(text, /^proxy_accounts\{state="available"\} 1$/m);
        assert.match(text, /^process_uptime_seconds \d+$/m);
        assert.ok(!text.includes(ACCOUNT_TOKEN) && !text.includes('mock-account'), 'no account identity in metrics');
    });

    it('sets security headers and hides the framework', async () => {
        const api = await fetch(`${proxy.baseUrl}/v1/models`);
        assert.equal(api.headers.get('x-powered-by'), null);
        assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(api.headers.get('x-frame-options'), 'DENY');
        assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
        const dash = await fetch(`${proxy.baseUrl}/dashboard`);
        assert.equal(dash.status, 200);
        assert.match(dash.headers.get('content-security-policy'), /frame-ancestors 'self' vscode-webview:/);
    });
});

describe('readiness without accounts', () => {
    let proxy;
    before(async () => {
        proxy = await startProxy({ accounts: [] });
    });
    after(async () => {
        await proxy?.stop();
    });

    it('GET /readyz is 503 when no account can serve requests', async () => {
        const res = await fetch(`${proxy.baseUrl}/readyz`);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).status, 'not_ready');
    });
});

describe('rate limiting', () => {
    let upstream;
    let proxy;
    before(async () => {
        upstream = await startScriptedUpstream();
        proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [account],
            env: { MANAGEMENT_RATE_LIMIT: '25' }
        });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('limits management endpoints per client with an Anthropic-style 429, but not the Messages API', async () => {
        let limited = null;
        for (let i = 0; i < 40 && !limited; i++) {
            const res = await fetch(`${proxy.baseUrl}/livez`);
            if (res.status === 429) limited = res;
            else await res.arrayBuffer();
        }
        assert.ok(limited, 'expected a 429 within 40 requests');
        assert.equal(limited.headers.get('retry-after'), '60');
        const body = await limited.json();
        assert.equal(body.error.type, 'rate_limit_error');

        const msg = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message())
        });
        assert.equal(msg.status, 200);
    });
});

describe('graceful shutdown', () => {
    it('finishes an in-flight SSE stream after SIGTERM, refuses new connections and exits 0', async () => {
        const upstream = await startScriptedUpstream();
        const proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [account],
            env: { SHUTDOWN_TIMEOUT: '10000' }
        });
        try {
            upstream.enqueue({
                sse: [textChunk('one '), textChunk('two '), textChunk('three '), textChunk('four', 'STOP')],
                chunkDelayMs: 250
            });
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(message({ stream: true }))
            });
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let text = '';
            // Wait for the first event, then ask the proxy to stop
            while (!text.includes('content_block_delta')) {
                const { value, done } = await reader.read();
                assert.ok(!done, 'stream ended before the first delta');
                text += decoder.decode(value, { stream: true });
            }
            proxy.child.kill('SIGTERM');
            await new Promise(r => setTimeout(r, 150));
            await assert.rejects(fetch(`${proxy.baseUrl}/livez`), 'new connections are refused while draining');

            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                text += decoder.decode(value, { stream: true });
            }
            const events = parseSse(text);
            assert.equal(events.at(-1).event, 'message_stop');
            const streamed = events
                .filter(e => e.event === 'content_block_delta')
                .map(e => e.data.delta.text)
                .join('');
            assert.equal(streamed, 'one two three four');
            assert.equal(await proxy.exited, 0, proxy.logs());
            assert.match(proxy.logs(), /Shutdown complete \(drained\)/);
        } finally {
            await proxy.stop();
            await upstream.close();
        }
    });
});
