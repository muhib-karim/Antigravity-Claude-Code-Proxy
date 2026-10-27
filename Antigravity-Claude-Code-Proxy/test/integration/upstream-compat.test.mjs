/**
 * Integration tests for upstream compatibility problems users hit in the field:
 * - the Antigravity client version in the User-Agent (ANTIGRAVITY_VERSION) and the
 *   "This version of Antigravity is no longer supported" rejection;
 * - Perplexity models when the separate Perplexity backend (PERPLEXITY_SERVER_URL) is down,
 *   answers with an HTTP error, or works.
 * The real proxy process runs against scripted mock upstreams.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startProxy, getFreePort, FAKE_PROJECT_ID } from '../../tests/smoke/helpers.mjs';
import { startScriptedUpstream } from '../helpers/scripted-upstream.mjs';
import { parseSse } from '../helpers/match.mjs';

const account = { email: 'mock-account', source: 'manual', apiKey: 'mock-token', projectId: FAKE_PROJECT_ID };
const FAST_RETRIES = { UPSTREAM_RETRIES: '1', RETRY_BASE_MS: '5', RETRY_MAX_MS: '10' };
const UNSUPPORTED = 'This version of Antigravity is no longer supported. Please update to receive the latest features!';

/**
 * @param {string} baseUrl
 * @param {object} body
 */
function postMessages(baseUrl, body) {
    return fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

const gemini = (extra = {}) => ({
    model: 'gemini-3-flash',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Say hello' }],
    ...extra
});

// The request body from the issue report
const pplx = (extra = {}) => ({
    model: 'pplx-grok',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'What color is the sky?' }],
    ...extra
});

const userAgentRe = version => new RegExp(`^antigravity/${version.replace(/\./g, '\\.')} [a-z0-9]+/[a-z0-9_]+$`);

describe('ANTIGRAVITY_VERSION: User-Agent sent upstream', () => {
    /** @type {Array<{name: string, env: Record<string, string>, expected: string}>} */
    const cases = [
        { name: 'defaults to 2.5.5', env: {}, expected: '2.5.5' },
        { name: 'is overridden by ANTIGRAVITY_VERSION', env: { ANTIGRAVITY_VERSION: '2.7.1' }, expected: '2.7.1' },
        { name: 'falls back to 2.5.5 for an invalid value', env: { ANTIGRAVITY_VERSION: 'v3' }, expected: '2.5.5' }
    ];

    for (const { name, env, expected } of cases) {
        it(name, async () => {
            const upstream = await startScriptedUpstream();
            const proxy = await startProxy({ upstreamUrl: upstream.url, accounts: [account], env });
            try {
                const res = await postMessages(proxy.baseUrl, gemini());
                assert.equal(res.status, 200, await res.clone().text());
                await res.arrayBuffer();
                const stream = await postMessages(proxy.baseUrl, gemini({ stream: true }));
                assert.equal(stream.status, 200);
                await stream.text();

                assert.equal(upstream.requests.length, 2);
                for (const request of upstream.requests) {
                    assert.match(request.headers['user-agent'], userAgentRe(expected));
                }
                if (env.ANTIGRAVITY_VERSION === 'v3') {
                    const warnings =
                        proxy.logs().match(/ANTIGRAVITY_VERSION "v3" is not a dotted x\.y\.z version/g) ?? [];
                    assert.equal(warnings.length, 1, proxy.logs());
                }
            } finally {
                await proxy.stop();
                await upstream.close();
            }
        });
    }
});

describe('"no longer supported" rejection from the upstream', () => {
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

    const rejection = status => ({
        status,
        json: { error: { code: status, message: UNSUPPORTED, status: 'FAILED_PRECONDITION' } }
    });

    /**
     * @param {Response} res
     */
    async function assertVersionHint(res) {
        assert.equal(res.status, 400);
        assert.match(res.headers.get('content-type'), /^application\/json/);
        const body = await res.json();
        assert.equal(body.type, 'error');
        assert.equal(body.error.type, 'invalid_request_error');
        assert.match(body.error.message, /no longer supported/);
        assert.match(body.error.message, /antigravity\/2\.5\.5/);
        assert.match(body.error.message, /ANTIGRAVITY_VERSION/);
        return body;
    }

    it('non-streaming: maps the upstream error to a 400 with the version hint', async () => {
        upstream.reset();
        upstream.enqueue(rejection(400));
        await assertVersionHint(await postMessages(proxy.baseUrl, gemini()));
        assert.equal(upstream.requests.length, 1);
    });

    it('streaming: answers the same JSON error before any SSE is sent', async () => {
        upstream.reset();
        upstream.enqueue(rejection(426));
        await assertVersionHint(await postMessages(proxy.baseUrl, gemini({ stream: true })));
    });

    it('does not retry the rejection even when the upstream sends it as a 5xx', async () => {
        upstream.reset();
        upstream.enqueue(rejection(500), rejection(500));
        await assertVersionHint(await postMessages(proxy.baseUrl, gemini()));
        assert.equal(upstream.requests.length, 1, 'a rejected client version is final');
    });

    it('logs the hint once', () => {
        const hints = proxy.logs().match(/\[CloudCode\] [^\n]*Set ANTIGRAVITY_VERSION/g) ?? [];
        assert.equal(hints.length, 1, proxy.logs());
    });

    it('leaves the same words inside a successful model reply alone', async () => {
        upstream.reset();
        upstream.enqueue({
            json: {
                response: {
                    candidates: [{ content: { role: 'model', parts: [{ text: UNSUPPORTED }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                }
            }
        });
        const res = await postMessages(proxy.baseUrl, gemini());
        assert.equal(res.status, 200);
        assert.equal((await res.json()).content[0].text, UNSUPPORTED);
    });
});

describe('Perplexity backend not running', () => {
    let proxy;
    let backendUrl;

    before(async () => {
        // A port that was just free and is now closed: connections are refused
        backendUrl = `http://127.0.0.1:${await getFreePort()}`;
        proxy = await startProxy({ accounts: [account], env: { PERPLEXITY_SERVER_URL: backendUrl } });
    });
    after(async () => {
        await proxy?.stop();
    });

    /**
     * @param {Response} res
     */
    async function assertUnreachable(res) {
        assert.equal(res.status, 503);
        assert.match(res.headers.get('content-type'), /^application\/json/);
        const body = await res.json();
        assert.deepEqual(body, {
            type: 'error',
            error: {
                type: 'api_error',
                message:
                    `Perplexity backend is not reachable at ${backendUrl} (ECONNREFUSED). Perplexity models need the ` +
                    'separate Perplexity server running; start it or set PERPLEXITY_SERVER_URL. ' +
                    'Gemini and Claude models are unaffected.'
            }
        });
    }

    it('streaming request (the reported case) gets a 503 JSON error with the URL and the fix', async () => {
        await assertUnreachable(await postMessages(proxy.baseUrl, pplx({ stream: true })));
    });

    it('non-streaming request gets the same 503', async () => {
        await assertUnreachable(await postMessages(proxy.baseUrl, pplx()));
    });

    it('/perplexity-stats reports the configured backend as not running', async () => {
        const res = await fetch(`${proxy.baseUrl}/perplexity-stats`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { error: 'Python server not running', requests_today: 0 });
    });
});

describe('Perplexity backend replies', () => {
    let backend;
    let proxy;

    before(async () => {
        backend = await startScriptedUpstream();
        proxy = await startProxy({
            accounts: [account],
            env: { PERPLEXITY_SERVER_URL: `${backend.url}/`, RATE_LIMIT_STATUS: '429' }
        });
    });
    after(async () => {
        await proxy?.stop();
        await backend?.close();
    });

    it('forwards to <PERPLEXITY_SERVER_URL>/v1/chat/completions and converts the reply', async () => {
        backend.reset();
        backend.enqueue({
            json: { id: 'chatcmpl-1', choices: [{ message: { role: 'assistant', content: 'Blue.' } }] }
        });
        const res = await postMessages(proxy.baseUrl, pplx());
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.content[0].text, 'Blue.');
        assert.equal(backend.requests[0].url, '/v1/chat/completions');
        assert.equal(backend.requests[0].body.model, 'pplx-grok');
        assert.notEqual(backend.requests[0].body.stream, true);
    });

    it('streams an OpenAI SSE reply as Anthropic events', async () => {
        backend.reset();
        backend.enqueue({
            sse: [{ choices: [{ delta: { content: 'Bl' } }] }, { choices: [{ delta: { content: 'ue.' } }] }]
        });
        const res = await postMessages(proxy.baseUrl, pplx({ stream: true }));
        assert.equal(res.status, 200);
        const events = parseSse(await res.text());
        const text = events
            .filter(e => e.event === 'content_block_delta')
            .map(e => e.data.delta.text)
            .join('');
        assert.equal(text, 'Blue.');
        assert.equal(events.at(-1).event, 'message_stop');
    });

    it('maps a backend 500 to 502 api_error instead of an opaque 500', async () => {
        backend.reset();
        backend.enqueue({ status: 500, json: { error: { message: 'upstream exploded' } } });
        const res = await postMessages(proxy.baseUrl, pplx({ stream: true }));
        assert.equal(res.status, 502);
        const body = await res.json();
        assert.equal(body.error.type, 'api_error');
        assert.match(body.error.message, /upstream exploded/);
    });

    it('maps a backend 429 to a rate_limit_error that keeps Retry-After', async () => {
        backend.reset();
        backend.enqueue({ status: 429, headers: { 'retry-after': '12' }, json: { error: { message: 'slow down' } } });
        const res = await postMessages(proxy.baseUrl, pplx());
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), '12');
        assert.equal((await res.json()).error.type, 'rate_limit_error');
    });

    it('maps a backend 400 to 400 invalid_request_error', async () => {
        backend.reset();
        backend.enqueue({ status: 400, json: { error: { message: 'model not allowed' } } });
        const res = await postMessages(proxy.baseUrl, pplx());
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.type, 'invalid_request_error');
        assert.equal(body.error.message, 'model not allowed');
    });

    it('reports a connection lost mid-stream as an SSE error event', async () => {
        backend.reset();
        backend.enqueue({ sse: [{ choices: [{ delta: { content: 'Bl' } }] }], destroy: true });
        const res = await postMessages(proxy.baseUrl, pplx({ stream: true }));
        assert.equal(res.status, 200);
        const events = parseSse(await res.text());
        const last = events.at(-1);
        assert.equal(last.event, 'error');
        assert.equal(last.data.error.type, 'api_error');
        assert.match(last.data.error.message, /Perplexity backend/);
    });

    it('reads /perplexity-stats from the configured backend', async () => {
        backend.reset();
        backend.enqueue({ json: { requests_today: 3 } });
        const res = await fetch(`${proxy.baseUrl}/perplexity-stats`);
        assert.deepEqual(await res.json(), { requests_today: 3 });
        assert.equal(backend.requests[0].url, '/stats');
    });
});
