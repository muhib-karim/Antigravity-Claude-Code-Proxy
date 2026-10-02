/**
 * Shared helpers for the offline smoke tests.
 *
 * - startMockUpstream(): a local HTTP server that imitates the Cloud Code
 *   `v1internal:generateContent` / `v1internal:streamGenerateContent` endpoints,
 *   so no real Google or Perplexity credentials are needed.
 * - startProxy(): spawns `node src/index.js` in an isolated temp HOME with a
 *   fake account and CLOUDCODE_ENDPOINTS pointing at the mock.
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FAKE_ACCESS_TOKEN = 'mock-access-token';
export const FAKE_PROJECT_ID = 'mock-project';

/**
 * Find a free TCP port on the loopback interface.
 * @returns {Promise<number>}
 */
export function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/**
 * Start a mock Cloud Code upstream.
 * @param {string} replyText - Text the mock model answers with
 * @returns {Promise<{url: string, requests: Array<object>, close: () => Promise<void>}>}
 */
export async function startMockUpstream(replyText = 'Hello from the mock upstream') {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let json = null;
            try { json = JSON.parse(body); } catch { /* not JSON */ }
            requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });

            const usageMetadata = { promptTokenCount: 7, candidatesTokenCount: 5 };

            // Prompts containing CALL_TOOL get a function call back (Gemini reports finishReason STOP for these)
            if (body.includes('CALL_TOOL')) {
                const part = { functionCall: { name: 'get_weather', args: { city: 'Paris' } } };
                const payload = { response: { candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }], usageMetadata } };
                if (req.url.startsWith('/v1internal:streamGenerateContent')) {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.end(`data: ${JSON.stringify(payload)}\n\n`);
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(payload));
                }
                return;
            }

            if (req.url.startsWith('/v1internal:streamGenerateContent')) {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                const half = Math.ceil(replyText.length / 2);
                const chunks = [
                    { response: { candidates: [{ content: { role: 'model', parts: [{ text: replyText.slice(0, half) }] } }] } },
                    {
                        response: {
                            candidates: [{ content: { role: 'model', parts: [{ text: replyText.slice(half) }] }, finishReason: 'STOP' }],
                            usageMetadata
                        }
                    }
                ];
                for (const chunk of chunks) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                res.end();
                return;
            }

            if (req.url.startsWith('/v1internal:generateContent')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    response: {
                        candidates: [{ content: { role: 'model', parts: [{ text: replyText }] }, finishReason: 'STOP' }],
                        usageMetadata
                    }
                }));
                return;
            }

            if (req.url.startsWith('/v1internal:fetchAvailableModels')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    models: {
                        'gemini-3-flash': { displayName: 'Gemini 3 Flash', quotaInfo: { remainingFraction: 1 } },
                        'gemini-3-pro-high': { displayName: 'Gemini 3 Pro (High)', quotaInfo: { remainingFraction: 0.5 } }
                    }
                }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 404, message: `mock: no handler for ${req.url}` } }));
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise(resolve => server.close(() => resolve()))
    };
}

/**
 * Spawn the proxy server in an isolated temporary environment.
 * @param {object} options
 * @param {string} [options.upstreamUrl] - Mock Cloud Code base URL
 * @param {Array<object>} [options.accounts] - Accounts written to the temp accounts.json
 * @param {Object<string, string>} [options.stateFiles] - Files pre-seeded into the state dir (name -> content)
 * @param {Object<string, string>} [options.homeFiles] - Files pre-seeded into the temp HOME (relative path -> content)
 * @param {Object<string, string>} [options.env] - Extra environment variables for the proxy process
 * @returns {Promise<{baseUrl: string, home: string, stateDir: string, logs: () => string, stop: () => Promise<void>}>}
 */
export async function startProxy({ upstreamUrl, accounts = [], stateFiles = {}, homeFiles = {}, env: extraEnv = {} } = {}) {
    const tmp = mkdtempSync(join(tmpdir(), 'ag-proxy-test-'));
    const home = join(tmp, 'home');
    const stateDir = join(tmp, 'state');
    mkdirSync(home, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    for (const [name, content] of Object.entries(stateFiles)) {
        writeFileSync(join(stateDir, name), content);
    }
    for (const [relPath, content] of Object.entries(homeFiles)) {
        const target = join(home, relPath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }

    const accountsPath = join(tmp, 'accounts.json');
    writeFileSync(accountsPath, JSON.stringify({ accounts, settings: {}, activeIndex: 0 }, null, 2));

    const port = await getFreePort();
    const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, 'AppData'),
        HOST: '127.0.0.1',
        PORT: String(port),
        ACCOUNT_CONFIG_PATH: accountsPath,
        PERPLEXITY_CONFIG_PATH: join(tmp, 'perplexity_accounts.json'),
        PROXY_STATE_DIR: stateDir,
        CLOUDCODE_ENDPOINTS: upstreamUrl || 'http://127.0.0.1:9',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
        REQUEST_TIMEOUT: '10000',
        MAX_RETRIES: '1',
        ...extraEnv
    };
    delete env.FORCE_COLOR;

    const child = spawn(process.execPath, ['src/index.js'], {
        cwd: PACKAGE_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });

    const baseUrl = `http://127.0.0.1:${port}`;

    // Wait until /health answers (or the process dies)
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) break;
        try {
            const res = await fetch(`${baseUrl}/health`);
            if (res.ok) { ready = true; break; }
        } catch { /* not listening yet */ }
        await new Promise(r => setTimeout(r, 100));
    }

    const stop = async () => {
        if (child.exitCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
            await exited;
            clearTimeout(timer);
        }
        rmSync(tmp, { recursive: true, force: true });
    };

    if (!ready) {
        await stop();
        throw new Error(`Proxy did not become ready on ${baseUrl}.\n--- proxy output ---\n${output}`);
    }

    return { baseUrl, home, stateDir, logs: () => output, stop };
}
