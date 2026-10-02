/**
 * End-to-end smoke tests: start the real proxy process against a mock
 * Cloud Code upstream and exercise the Anthropic-compatible API.
 * No provider credentials or network access are required.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startMockUpstream, startProxy, FAKE_ACCESS_TOKEN, FAKE_PROJECT_ID, PACKAGE_ROOT } from './helpers.mjs';

const REPLY = 'Hello from the mock upstream';

describe('proxy with a mocked upstream account', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startMockUpstream(REPLY);
        proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [{ email: 'mock-account', source: 'manual', apiKey: FAKE_ACCESS_TOKEN, projectId: FAKE_PROJECT_ID }]
        });
    });

    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('GET /health reports ok with the configured account', async () => {
        const res = await fetch(`${proxy.baseUrl}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(body.available, 1);
        assert.match(body.accounts, /1 total, 1 available/);
    });

    it('GET /v1/models returns a model list', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/models`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(Array.isArray(body.data), 'data should be an array');
        const ids = body.data.map(m => m.id);
        assert.ok(ids.includes('gemini-3-flash'), `models: ${ids}`);
        assert.ok(ids.includes('gemini-3-pro-high'), 'models reported by the upstream should be listed');
    });

    it('unknown endpoints return an Anthropic-style 404 error', async () => {
        const res = await fetch(`${proxy.baseUrl}/does-not-exist`);
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.type, 'error');
        assert.equal(body.error.type, 'not_found_error');
    });

    it('POST /v1/messages without messages is rejected with 400', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-3-flash', max_tokens: 16 })
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.type, 'invalid_request_error');
    });

    it('POST /v1/messages (non-streaming) is translated to Cloud Code and back', async () => {
        const before = upstream.requests.length;
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-3-flash',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Say hello' }]
            })
        });
        assert.equal(res.status, 200, proxy.logs());
        const body = await res.json();
        assert.equal(body.type, 'message');
        assert.equal(body.role, 'assistant');
        const text = body.content.filter(b => b.type === 'text').map(b => b.text).join('');
        assert.equal(text, REPLY);
        assert.equal(body.stop_reason, 'end_turn');

        const upstreamReq = upstream.requests.slice(before).find(r => r.url.startsWith('/v1internal:generateContent'));
        assert.ok(upstreamReq, 'proxy should call the generateContent endpoint');
        assert.equal(upstreamReq.headers.authorization, `Bearer ${FAKE_ACCESS_TOKEN}`);
        assert.equal(upstreamReq.body.project, FAKE_PROJECT_ID);
        assert.equal(upstreamReq.body.model, 'gemini-3-flash');
        const sentText = JSON.stringify(upstreamReq.body.request.contents);
        assert.ok(sentText.includes('Say hello'), 'user message should be forwarded upstream');
    });

    it('a per-session model set via /session-model is used for requests with X-Session-ID', async () => {
        const sessionId = 'smoke-session-0001';
        const set = await fetch(`${proxy.baseUrl}/session-model`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, model: 'gemini-3-pro-high' })
        });
        assert.equal(set.status, 200);

        const before = upstream.requests.length;
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-session-id': sessionId },
            body: JSON.stringify({
                model: 'gemini-3-flash',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Say hello' }]
            })
        });
        assert.equal(res.status, 200, proxy.logs());
        // Thinking models are fetched over the streaming endpoint even for non-streaming clients
        const upstreamReq = upstream.requests.slice(before).find(r => r.url.includes('GenerateContent') || r.url.includes('generateContent'));
        assert.ok(upstreamReq, 'proxy should call a generate endpoint');
        assert.equal(upstreamReq.body.model, 'gemini-3-pro-high');
    });

    it('POST /v1/messages (streaming) emits Anthropic SSE events', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-3-flash',
                max_tokens: 64,
                stream: true,
                messages: [{ role: 'user', content: 'Say hello' }]
            })
        });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/event-stream/);
        const raw = await res.text();

        const events = raw.split('\n\n')
            .map(block => block.split('\n').find(l => l.startsWith('data: ')))
            .filter(Boolean)
            .map(line => JSON.parse(line.slice(6)));
        const types = events.map(e => e.type);

        assert.ok(!types.includes('error'), `stream should not contain errors: ${raw}`);
        assert.equal(types[0], 'message_start');
        assert.equal(types[types.length - 1], 'message_stop');
        const text = events
            .filter(e => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
            .map(e => e.delta.text)
            .join('');
        assert.equal(text, REPLY);
    });

    const toolRequest = stream => ({
        model: 'gemini-3-flash',
        max_tokens: 64,
        stream,
        tools: [{
            name: 'get_weather',
            description: 'Get the weather for a city',
            input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }
        }],
        messages: [{ role: 'user', content: 'CALL_TOOL for Paris' }]
    });

    it('tool calls come back as tool_use with stop_reason tool_use (non-streaming)', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(toolRequest(false))
        });
        assert.equal(res.status, 200, proxy.logs());
        const body = await res.json();
        const toolUse = body.content.find(b => b.type === 'tool_use');
        assert.ok(toolUse, `expected a tool_use block: ${JSON.stringify(body)}`);
        assert.equal(toolUse.name, 'get_weather');
        assert.deepEqual(toolUse.input, { city: 'Paris' });
        assert.equal(body.stop_reason, 'tool_use');
    });

    it('tool calls come back as tool_use with stop_reason tool_use (streaming)', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(toolRequest(true))
        });
        assert.equal(res.status, 200);
        const raw = await res.text();
        const events = raw.split('\n\n')
            .map(block => block.split('\n').find(l => l.startsWith('data: ')))
            .filter(Boolean)
            .map(line => JSON.parse(line.slice(6)));
        const start = events.find(e => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
        assert.ok(start, `expected a tool_use block: ${raw}`);
        assert.equal(start.content_block.name, 'get_weather');
        const messageDelta = events.find(e => e.type === 'message_delta');
        assert.equal(messageDelta.delta.stop_reason, 'tool_use');
    });
});

describe('proxy without any accounts', () => {
    let proxy;

    before(async () => {
        proxy = await startProxy({ accounts: [] });
    });

    after(async () => {
        await proxy?.stop();
    });

    it('GET /health still answers', async () => {
        const res = await fetch(`${proxy.baseUrl}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(body.available, 0);
    });

    it('POST /v1/messages fails fast with a clear error instead of waiting on a cooldown', async () => {
        const started = Date.now();
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-3-flash',
                max_tokens: 16,
                messages: [{ role: 'user', content: 'Say hello' }]
            }),
            signal: AbortSignal.timeout(20000)
        });
        const elapsed = Date.now() - started;
        assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);
        const body = await res.json();
        assert.equal(body.type, 'error');
        assert.match(body.error.message, /No accounts available/);
        assert.ok(elapsed < 10000, `request took ${elapsed}ms`);
    });
});

describe('model switching endpoints', () => {
    let proxy;

    before(async () => {
        proxy = await startProxy({ accounts: [] });
    });

    after(async () => {
        await proxy?.stop();
    });

    const post = (path, body) => fetch(`${proxy.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });

    it('rejects model names that could inject into settings files', async () => {
        const injected = 'x", "apiKeyHelper": "calc.exe';
        const global = await post('/active-model', { model: injected });
        assert.equal(global.status, 400);
        const session = await post('/session-model', { sessionId: 'abc12345', model: injected });
        assert.equal(session.status, 400);

        const current = await (await fetch(`${proxy.baseUrl}/active-model`)).json();
        assert.equal(current.isOverride, false);
    });

    it('refuses requests from foreign web origins but allows local ones', async () => {
        const foreign = await fetch(`${proxy.baseUrl}/active-model`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
            body: JSON.stringify({ model: 'gemini-3-flash' })
        });
        assert.equal(foreign.status, 403);
        assert.equal(foreign.headers.get('access-control-allow-origin'), null);
        const current = await (await fetch(`${proxy.baseUrl}/active-model`)).json();
        assert.equal(current.isOverride, false);

        const local = await fetch(`${proxy.baseUrl}/health`, { headers: { origin: 'http://localhost:8080' } });
        assert.equal(local.status, 200);
        assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:8080');
    });

    it('refuses DNS-rebinding style requests with a foreign Host header', async () => {
        const getWithHost = host => new Promise((resolve, reject) => {
            const { hostname, port } = new URL(proxy.baseUrl);
            const req = http.request({ hostname, port, path: '/sessions', headers: { host } }, res => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', reject);
            req.end();
        });
        const port = new URL(proxy.baseUrl).port;
        assert.equal(await getWithHost(`attacker.example:${port}`), 403);
        assert.equal(await getWithHost(`localhost:${port}`), 200);
    });

    it('accepts a normal model id and can clear the override', async () => {
        const res = await post('/active-model', { model: 'gemini-3-flash' });
        assert.equal(res.status, 200);
        const current = await (await fetch(`${proxy.baseUrl}/active-model`)).json();
        assert.equal(current.model, 'gemini-3-flash');
        assert.equal(current.isOverride, true);

        const cleared = await fetch(`${proxy.baseUrl}/active-model`, { method: 'DELETE' });
        assert.equal(cleared.status, 200);
        const after = await (await fetch(`${proxy.baseUrl}/active-model`)).json();
        assert.equal(after.isOverride, false);
    });
});

describe('proxy restart with a persisted model override', () => {
    let proxy;
    const vscodeSettings = join('AppData', 'Code', 'User', 'settings.json');

    before(async () => {
        proxy = await startProxy({
            stateFiles: { 'model-override.json': JSON.stringify({ model: 'gemini-3-pro-high' }) },
            homeFiles: { [vscodeSettings]: '{\n  "claudeCode.selectedModel": "gemini-3-flash",\n  "editor.fontSize": 14\n}\n' }
        });
    });

    after(async () => {
        await proxy?.stop();
    });

    it('starts, restores the override and syncs it into editor settings', async () => {
        const res = await fetch(`${proxy.baseUrl}/active-model`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.model, 'gemini-3-pro-high');
        assert.equal(body.isOverride, true);

        const settings = JSON.parse(readFileSync(join(proxy.home, vscodeSettings), 'utf-8'));
        assert.equal(settings['claudeCode.selectedModel'], 'gemini-3-pro-high');
        assert.equal(settings['editor.fontSize'], 14);
    });
});

describe('account rotation when a token refresh cannot reach Google', () => {
    let upstream;
    let proxy;
    const preload = pathToFileURL(join(PACKAGE_ROOT, 'tests', 'smoke', 'fixtures', 'google-token-unreachable.mjs')).href;

    before(async () => {
        upstream = await startMockUpstream('hello from the second account');
        proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [
                { email: 'oauth-account', source: 'oauth', refreshToken: 'mock-refresh-token', projectId: FAKE_PROJECT_ID },
                { email: 'manual-account', source: 'manual', apiKey: FAKE_ACCESS_TOKEN, projectId: FAKE_PROJECT_ID }
            ],
            env: { NODE_OPTIONS: `--import=${preload}` }
        });
    });

    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('falls through to the next account without marking the first one invalid', async () => {
        const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-3-flash',
                max_tokens: 64,
                messages: [{ role: 'user', content: 'Say hello' }]
            })
        });
        assert.equal(res.status, 200, proxy.logs());
        const body = await res.json();
        assert.equal(body.content.filter(b => b.type === 'text').map(b => b.text).join(''), 'hello from the second account');

        const health = await (await fetch(`${proxy.baseUrl}/health`)).json();
        assert.equal(health.invalid, 0, JSON.stringify(health));
        assert.equal(health.rateLimited, 1, 'the unreachable account is only parked for a short cooldown');
    });
});
