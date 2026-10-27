/**
 * Integration tests for behaviour that changed with Express 5 (path-to-regexp v8, body-parser 2,
 * req.body/req.query semantics, async error forwarding, express.static dotfiles): the 404 catch-all,
 * body-parser errors, management routes hit without a JSON body, query parsing, the dashboard and
 * security headers. The real proxy process runs against the mock upstream in a temp home.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    startMockUpstream,
    startProxy,
    PACKAGE_ROOT,
    FAKE_ACCESS_TOKEN,
    FAKE_PROJECT_ID
} from '../../tests/smoke/helpers.mjs';

const account = { email: 'mock-account', source: 'manual', apiKey: FAKE_ACCESS_TOKEN, projectId: FAKE_PROJECT_ID };

const message = { model: 'gemini-3-flash', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };

/**
 * @param {Response} res
 * @param {number} status
 * @param {string} type - Anthropic error type
 */
async function assertJsonError(res, status, type) {
    assert.equal(res.status, status);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    const body = await res.json();
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, type);
    return body;
}

describe('Express 5 routing and body handling', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startMockUpstream();
        proxy = await startProxy({
            upstreamUrl: upstream.url,
            accounts: [account],
            env: { REQUEST_BODY_LIMIT: '16kb' }
        });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    describe('404 catch-all', () => {
        for (const [method, path] of [
            ['GET', '/no-such-endpoint'],
            ['POST', '/v1/no-such-endpoint'],
            ['DELETE', '/no-such-endpoint'],
            ['PUT', '/active-model'],
            ['GET', '/a/b/c?x=1'],
            ['GET', '/*'],
            ['GET', '/']
        ]) {
            it(`${method} ${path} answers 404 not_found_error naming the method and original URL`, async () => {
                const res = await fetch(`${proxy.baseUrl}${path}`, {
                    method,
                    ...(method === 'GET' || method === 'DELETE'
                        ? {}
                        : { headers: { 'content-type': 'application/json' }, body: '{}' })
                });
                const body = await assertJsonError(res, 404, 'not_found_error');
                assert.equal(body.error.message, `Endpoint ${method} ${path} not found`);
            });
        }

        it('does not serve dotfiles from the static directory', async () => {
            const res = await fetch(`${proxy.baseUrl}/.env`);
            await assertJsonError(res, 404, 'not_found_error');
        });
    });

    describe('body-parser errors', () => {
        it('maps a malformed JSON body to 400 invalid_request_error', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{"model": "gemini-3-flash", "messages": ['
            });
            const body = await assertJsonError(res, 400, 'invalid_request_error');
            assert.equal(body.error.message, 'Request body is not valid JSON');
        });

        it('maps a body over REQUEST_BODY_LIMIT to 413 request_too_large', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ...message, messages: [{ role: 'user', content: 'x'.repeat(32 * 1024) }] })
            });
            await assertJsonError(res, 413, 'request_too_large');
        });

        it('maps an unsupported charset to a 415 JSON error', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json; charset=x-unknown' },
                body: JSON.stringify(message)
            });
            await assertJsonError(res, 415, 'invalid_request_error');
        });

        it('maps an unsupported content-encoding to a 415 JSON error', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'content-encoding': 'x-unknown' },
                body: JSON.stringify(message)
            });
            await assertJsonError(res, 415, 'invalid_request_error');
        });

        it('rejects POST /v1/messages without a body as invalid_request_error', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, { method: 'POST' });
            // fetch sends content-length: 0 with no content-type, so either validation message may apply
            const body = await assertJsonError(res, 400, 'invalid_request_error');
            assert.match(body.error.message, /body: must be a JSON object|content-type: must be application\/json/);
        });

        it('rejects POST /v1/messages with a text/plain body as invalid_request_error', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: JSON.stringify(message)
            });
            const body = await assertJsonError(res, 400, 'invalid_request_error');
            assert.match(body.error.message, /content-type: must be application\/json/);
        });

        it('still accepts a well-formed request', async () => {
            const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(message)
            });
            assert.equal(res.status, 200);
            assert.equal((await res.json()).type, 'message');
        });
    });

    describe('management routes without a JSON body (req.body is undefined)', () => {
        const cases = [
            ['POST', '/active-model', 'model is required'],
            ['POST', '/session-model', 'model is required'],
            ['POST', '/perplexity-sessions', 'email and sessionToken are required'],
            ['PATCH', '/perplexity-sessions/someone', 'newName is required']
        ];
        for (const [method, path, error] of cases) {
            it(`${method} ${path} with no body answers 400, not 500`, async () => {
                const res = await fetch(`${proxy.baseUrl}${path}`, { method });
                assert.equal(res.status, 400);
                assert.deepEqual(await res.json(), { error });
            });

            it(`${method} ${path} with a text/plain body answers 400, not 500`, async () => {
                const res = await fetch(`${proxy.baseUrl}${path}`, {
                    method,
                    headers: { 'content-type': 'text/plain' },
                    body: '{"model":"gemini-3-flash","newName":"x","email":"a@b","sessionToken":"t"}'
                });
                assert.equal(res.status, 400);
                assert.deepEqual(await res.json(), { error });
            });
        }

        it('POST /active-model with a JSON body still works', async () => {
            const set = await fetch(`${proxy.baseUrl}/active-model`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'gemini-3-flash' })
            });
            assert.equal(set.status, 200);
            assert.equal((await set.json()).model, 'gemini-3-flash');
            const cleared = await fetch(`${proxy.baseUrl}/active-model`, { method: 'DELETE' });
            assert.equal(cleared.status, 200);
        });
    });

    describe('query parsing', () => {
        it('GET /account-limits defaults to JSON', async () => {
            const res = await fetch(`${proxy.baseUrl}/account-limits`);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /^application\/json/);
            assert.equal((await res.json()).totalAccounts, 1);
        });

        it('GET /account-limits?format=table renders text', async () => {
            const res = await fetch(`${proxy.baseUrl}/account-limits?format=table`);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /^text\/plain/);
            assert.match(await res.text(), /^Account Limits/);
        });

        for (const query of ['format=table&format=json', 'format[x]=table', 'format=']) {
            it(`GET /account-limits?${query} falls back to JSON`, async () => {
                const res = await fetch(`${proxy.baseUrl}/account-limits?${query}`);
                assert.equal(res.status, 200);
                assert.match(res.headers.get('content-type'), /^application\/json/);
            });
        }
    });

    describe('dashboard and headers', () => {
        it('serves the dashboard at /dashboard and /dashboard.html', async () => {
            for (const path of ['/dashboard', '/dashboard.html']) {
                const res = await fetch(`${proxy.baseUrl}${path}`);
                assert.equal(res.status, 200, path);
                assert.match(res.headers.get('content-type'), /^text\/html/);
                assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self' vscode-webview:/);
                assert.match(await res.text(), /<html/i);
            }
        });

        it('sets security headers on API, error and static responses and hides the framework', async () => {
            for (const path of ['/livez', '/no-such-endpoint', '/dashboard.html']) {
                const res = await fetch(`${proxy.baseUrl}${path}`);
                await res.arrayBuffer();
                assert.equal(res.headers.get('x-powered-by'), null, path);
                assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path);
                assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path);
                assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin', path);
            }
            const api = await fetch(`${proxy.baseUrl}/no-such-endpoint`);
            assert.equal(api.headers.get('x-frame-options'), 'DENY');
            assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
        });
    });
});

describe('Express 5 async error forwarding (in-process)', () => {
    let tmp;
    let app;
    let server;
    let baseUrl;
    let loginService;

    before(async () => {
        tmp = mkdtempSync(join(tmpdir(), 'ag-proxy-express5-'));
        const accountsPath = join(tmp, 'accounts.json');
        writeFileSync(accountsPath, JSON.stringify({ accounts: [account], settings: {}, activeIndex: 0 }));
        Object.assign(process.env, {
            HOME: tmp,
            USERPROFILE: tmp,
            HOST: '127.0.0.1',
            ACCOUNT_CONFIG_PATH: accountsPath,
            PERPLEXITY_CONFIG_PATH: join(tmp, 'perplexity_accounts.json'),
            PROXY_STATE_DIR: tmp,
            CLOUDCODE_ENDPOINTS: 'http://127.0.0.1:9'
        });
        app = (await import('../../src/server.js')).default;
        const { getLoginService } = await import('../../src/perplexity-browser-login.js');
        // Same module instance as the server, so the route sees this service
        loginService = getLoginService({});
        await new Promise((resolve, reject) => {
            server = app.listen(0, '127.0.0.1', error => (error ? reject(error) : resolve()));
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
        await new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
        rmSync(tmp, { recursive: true, force: true });
    });

    it('a rejected async route handler becomes an Anthropic JSON error, not an HTML page', async () => {
        loginService.isActive = () => {
            throw new Error('login state unavailable');
        };
        const res = await fetch(`${baseUrl}/perplexity-login/status`);
        const body = await assertJsonError(res, 500, 'api_error');
        assert.equal(body.error.message, 'login state unavailable');
    });

    it('the error handler leaves an already-started response to Express instead of writing twice', () => {
        const errorHandler = app.router.stack.at(-1).handle;
        assert.equal(errorHandler.length, 4, 'last layer is the error handler');
        const writes = [];
        const res = {
            headersSent: true,
            write: chunk => writes.push(chunk),
            end: () => writes.push('end'),
            status: () => assert.fail('status() must not be called once headers are sent')
        };
        const err = new Error('stream broke');
        let forwarded;
        errorHandler(err, {}, res, e => (forwarded = e));
        assert.equal(forwarded, err);
        assert.deepEqual(writes, []);
    });
});

describe('startup on a busy port', () => {
    it('exits non-zero with a clear message instead of reporting the server as running', async () => {
        const blocker = net.createServer();
        await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
        const tmp = mkdtempSync(join(tmpdir(), 'ag-proxy-busy-'));
        try {
            const child = spawn(process.execPath, ['src/index.js'], {
                cwd: PACKAGE_ROOT,
                env: {
                    ...process.env,
                    HOME: tmp,
                    USERPROFILE: tmp,
                    HOST: '127.0.0.1',
                    PORT: String(blocker.address().port),
                    ACCOUNT_CONFIG_PATH: join(tmp, 'accounts.json'),
                    PERPLEXITY_CONFIG_PATH: join(tmp, 'perplexity_accounts.json'),
                    PROXY_STATE_DIR: tmp
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let output = '';
            child.stdout.on('data', d => (output += d));
            child.stderr.on('data', d => (output += d));
            const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
            const code = await new Promise(resolve => child.once('exit', resolve));
            clearTimeout(timer);
            assert.equal(code, 1, output);
            assert.match(output, /Could not listen on 127\.0\.0\.1:\d+: .*EADDRINUSE/);
            assert.doesNotMatch(output, /Server running at/);
        } finally {
            blocker.close();
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
