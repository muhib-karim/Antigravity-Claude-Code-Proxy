/**
 * Acceptance tests for the v2.12 expansion plan (issue #22):
 *   1. Prometheus /metrics and a richer /health
 *   2. Quota-aware account rotation (cooldown after 429, Retry-After, configurable strategy)
 *   3. Record/replay conformance fixtures
 *   4. GHCR multi-arch Docker publish with SBOM and provenance
 *   5. Windows smoke CI job
 *
 * What already exists (2.11 groundwork) is tested for real. Every plan item that is not built
 * yet is a `todo` test that encodes its acceptance check: it runs and reports, but cannot fail CI.
 */
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startProxy, getFreePort, PACKAGE_ROOT, FAKE_PROJECT_ID } from '../../tests/smoke/helpers.mjs';
import { startScriptedUpstream } from '../helpers/scripted-upstream.mjs';
import { AccountManager } from '../../src/account-manager.js';

const accounts = ['a', 'b'].map(n => ({
    email: `${n}@example.test`,
    source: 'manual',
    apiKey: `token-${n}`,
    projectId: FAKE_PROJECT_ID
}));
const FAST_RETRIES = { UPSTREAM_RETRIES: '1', RETRY_BASE_MS: '5', RETRY_MAX_MS: '10' };
// Cooldowns longer than this make the proxy switch accounts instead of waiting for the sticky one
const SWITCH_AFTER = { MAX_WAIT_BEFORE_ERROR: '500' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const message = (extra = {}) => ({
    model: 'gemini-3-flash',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
    ...extra
});

/**
 * @param {string} baseUrl
 * @param {object} [body]
 */
function postMessages(baseUrl, body = message()) {
    return fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/**
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function scrape(baseUrl) {
    const res = await fetch(`${baseUrl}/metrics`);
    assert.equal(res.status, 200);
    return res.text();
}

/**
 * Value of one exposition sample (0 when absent).
 * @param {string} text
 * @param {string} series - Metric name with its label set, exactly as rendered
 * @returns {number}
 */
function sample(text, series) {
    const escaped = series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped} (\\S+)$`, 'm').exec(text);
    return match ? Number(match[1]) : 0;
}

/** Which account (by its token) served each upstream request. */
const tokensUsed = upstream =>
    upstream.requests
        .filter(r => r.url.startsWith('/v1internal:generateContent'))
        .map(r => r.headers.authorization.replace('Bearer ', ''));

/** Workflow files of the repository (the package lives one level below the repo root). */
function readWorkflows() {
    const dirs = [join(PACKAGE_ROOT, '.github', 'workflows'), join(PACKAGE_ROOT, '..', '.github', 'workflows')];
    return dirs
        .filter(dir => existsSync(dir))
        .flatMap(dir =>
            readdirSync(dir)
                .filter(f => /\.ya?ml$/.test(f))
                .map(f => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }))
        );
}

/**
 * Spawn the proxy with extra node/CLI arguments (startProxy() only runs `node src/index.js`)
 * and wait for /livez, which answers even when the account pool failed to load.
 * @param {{nodeArgs?: string[], args?: string[], env?: Record<string, string>, upstreamUrl?: string}} options
 */
async function spawnProxy({ nodeArgs = [], args = [], env = {}, upstreamUrl = 'http://127.0.0.1:9' }) {
    const tmp = mkdtempSync(join(tmpdir(), 'ag-proxy-plan-'));
    const home = join(tmp, 'home');
    mkdirSync(home);
    const accountsPath = join(tmp, 'accounts.json');
    writeFileSync(accountsPath, JSON.stringify({ accounts, settings: {}, activeIndex: 0 }));
    const port = await getFreePort();
    const childEnv = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, 'AppData'),
        HOST: '127.0.0.1',
        PORT: String(port),
        ACCOUNT_CONFIG_PATH: accountsPath,
        PERPLEXITY_CONFIG_PATH: join(tmp, 'perplexity_accounts.json'),
        PROXY_STATE_DIR: join(tmp, 'state'),
        CLOUDCODE_ENDPOINTS: upstreamUrl,
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
        ...env
    };
    mkdirSync(childEnv.PROXY_STATE_DIR);
    const child = spawn(process.execPath, [...nodeArgs, 'src/index.js', ...args], {
        cwd: PACKAGE_ROOT,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    const baseUrl = `http://127.0.0.1:${port}`;
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
    for (const deadline = Date.now() + 15000; Date.now() < deadline && child.exitCode === null;) {
        try {
            if ((await fetch(`${baseUrl}/livez`)).ok) return { baseUrl, tmp, logs: () => output, stop };
        } catch {
            /* not listening yet */
        }
        await sleep(100);
    }
    await stop();
    throw new Error(`proxy did not start:\n${output}`);
}

// ---------------------------------------------------------------------------
// Plan item 1: Prometheus /metrics and a richer /health
// ---------------------------------------------------------------------------

describe('v2.12 plan item 1: /metrics and /health', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startScriptedUpstream();
        proxy = await startProxy({ upstreamUrl: upstream.url, accounts, env: FAST_RETRIES });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    it('serves the Prometheus 0.0.4 text format with HELP and TYPE for every metric', async () => {
        const res = await fetch(`${proxy.baseUrl}/metrics`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'text/plain; version=0.0.4; charset=utf-8');
        const text = await res.text();
        for (const [name, type] of [
            ['proxy_http_requests_total', 'counter'],
            ['proxy_http_request_duration_seconds', 'histogram'],
            ['proxy_upstream_retries_total', 'counter'],
            ['proxy_accounts', 'gauge'],
            ['process_uptime_seconds', 'gauge'],
            ['nodejs_heap_used_bytes', 'gauge']
        ]) {
            assert.match(text, new RegExp(`^# HELP ${name} \\S.*$`, 'm'), `HELP for ${name}`);
            assert.match(text, new RegExp(`^# TYPE ${name} ${type}$`, 'm'), `TYPE for ${name}`);
        }
        // Every sample line is "<name>{labels} <number>"
        for (const line of text.split('\n').filter(l => l && !l.startsWith('#'))) {
            assert.match(line, /^[a-z_:][a-z0-9_:]*(\{[^}]*\})? -?[0-9.e+]+$/i, line);
        }
    });

    it('counts /v1/messages requests by method, route and status', async () => {
        const series = 'proxy_http_requests_total{method="POST",route="/v1/messages",status="200"}';
        const before = sample(await scrape(proxy.baseUrl), series);
        const res = await postMessages(proxy.baseUrl);
        assert.equal(res.status, 200);
        await res.arrayBuffer();
        assert.equal(sample(await scrape(proxy.baseUrl), series), before + 1);
    });

    it('records latency in a cumulative histogram with +Inf, _sum and _count', async () => {
        const text = await scrape(proxy.baseUrl);
        const labels = 'method="POST",route="/v1/messages"';
        const buckets = [
            ...text.matchAll(
                new RegExp(`^proxy_http_request_duration_seconds_bucket\\{${labels},le="([^"]+)"\\} (\\d+)$`, 'gm')
            )
        ].map(m => ({ le: m[1], count: Number(m[2]) }));
        assert.ok(buckets.length >= 2, 'expected histogram buckets');
        assert.equal(buckets.at(-1).le, '+Inf');
        for (let i = 1; i < buckets.length; i++) {
            assert.ok(buckets[i].count >= buckets[i - 1].count, 'buckets are cumulative');
            if (buckets[i].le !== '+Inf') assert.ok(Number(buckets[i].le) > Number(buckets[i - 1].le), 'bounds ascend');
        }
        const count = sample(text, `proxy_http_request_duration_seconds_count{${labels}}`);
        assert.ok(count >= 1);
        assert.equal(buckets.at(-1).count, count, '+Inf bucket equals _count');
        assert.ok(sample(text, `proxy_http_request_duration_seconds_sum{${labels}}`) > 0);
    });

    it('counts upstream retries by reason after a mocked 5xx', async () => {
        const series = 'proxy_upstream_retries_total{reason="503"}';
        const before = sample(await scrape(proxy.baseUrl), series);
        upstream.enqueue({ status: 503, json: { error: { message: 'busy' } } });
        const res = await postMessages(proxy.baseUrl);
        assert.equal(res.status, 200, 'the retry succeeds');
        await res.arrayBuffer();
        assert.equal(sample(await scrape(proxy.baseUrl), series), before + 1);
    });

    it('exposes the account pool state as gauges without account identities', async () => {
        const text = await scrape(proxy.baseUrl);
        assert.equal(sample(text, 'proxy_accounts{state="total"}'), 2);
        assert.equal(sample(text, 'proxy_accounts{state="available"}'), 2);
        assert.equal(sample(text, 'proxy_accounts{state="rate_limited"}'), 0);
        assert.equal(sample(text, 'proxy_accounts{state="invalid"}'), 0);
        assert.ok(!text.includes('example.test') && !text.includes('token-a'));
    });

    it('GET /health returns a JSON summary of the account pool', async () => {
        const res = await fetch(`${proxy.baseUrl}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(Object.keys(body).sort(), [
            'accounts',
            'available',
            'invalid',
            'rateLimited',
            'status',
            'timestamp'
        ]);
        assert.equal(body.status, 'ok');
        assert.equal(body.accounts, '2 total, 2 available, 0 rate-limited, 0 invalid');
        assert.equal(body.available, 2);
        assert.equal(body.rateLimited, 0);
        assert.equal(body.invalid, 0);
        assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.ok(Math.abs(Date.parse(body.timestamp) - Date.now()) < 60_000);
    });

    it('GET /livez and GET /readyz report liveness and readiness', async () => {
        const live = await fetch(`${proxy.baseUrl}/livez`);
        assert.equal(live.status, 200);
        assert.deepEqual(await live.json(), { status: 'ok' });
        const ready = await fetch(`${proxy.baseUrl}/readyz`);
        assert.equal(ready.status, 200);
        assert.deepEqual(await ready.json(), { status: 'ready', available: 2 });
    });

    it(
        'counts upstream errors by status (e.g. 429) in their own counter',
        { todo: 'v2.12 plan item 1: no upstream error counter (proxy_upstream_errors_total{status}) yet' },
        async () => {
            upstream.enqueue({ status: 429, headers: { 'retry-after': '1' }, json: { error: { message: 'quota' } } });
            await (await postMessages(proxy.baseUrl)).arrayBuffer();
            assert.ok(sample(await scrape(proxy.baseUrl), 'proxy_upstream_errors_total{status="429"}') >= 1);
        }
    );

    it(
        'exposes per-account quota state as a gauge',
        { todo: 'v2.12 plan item 1: no per-account quota gauge (proxy_account_quota_remaining_ratio) yet' },
        async () => {
            const text = await scrape(proxy.baseUrl);
            assert.match(text, /^# TYPE proxy_account_quota_remaining_ratio gauge$/m);
            assert.match(text, /^proxy_account_quota_remaining_ratio\{account="[^"@]+",model="[^"]+"\} [0-9.]+$/m);
        }
    );

    it(
        'GET /health lists every configured account with its state',
        { todo: 'v2.12 plan item 1: /health has only pool counts, no per-account JSON summary' },
        async () => {
            const body = await (await fetch(`${proxy.baseUrl}/health`)).json();
            assert.ok(Array.isArray(body.accountDetails), 'accountDetails array');
            assert.equal(body.accountDetails.length, 2);
            for (const entry of body.accountDetails) {
                assert.ok(['available', 'rate_limited', 'invalid'].includes(entry.state));
                assert.ok('rateLimitResetTime' in entry && 'quota' in entry);
                assert.ok(!JSON.stringify(entry).includes('token-'), 'no credentials in /health');
            }
        }
    );
});

describe('v2.12 plan item 1: /health when initialisation fails', () => {
    let proxy;
    before(async () => {
        const preload = pathToFileURL(
            join(PACKAGE_ROOT, 'test', 'fixtures', 'preload', 'failing-account-init.mjs')
        ).href;
        proxy = await spawnProxy({ nodeArgs: ['--import', preload] });
    });
    after(async () => {
        await proxy?.stop();
    });

    it('GET /health answers 503 with status "error", the reason and a timestamp', async () => {
        const res = await fetch(`${proxy.baseUrl}/health`);
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.status, 'error');
        assert.match(body.error, /account store could not be loaded/);
        assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
    });

    it('GET /readyz is 503 not_ready while GET /livez and GET /metrics still answer', async () => {
        const ready = await fetch(`${proxy.baseUrl}/readyz`);
        assert.equal(ready.status, 503);
        assert.equal((await ready.json()).status, 'not_ready');
        assert.equal((await fetch(`${proxy.baseUrl}/livez`)).status, 200);
        assert.equal((await fetch(`${proxy.baseUrl}/metrics`)).status, 200);
    });
});

// ---------------------------------------------------------------------------
// Plan item 2: quota-aware account rotation
// ---------------------------------------------------------------------------

describe('v2.12 plan item 2: cooldown after 429 and Retry-After', () => {
    let upstream;
    let proxy;

    before(async () => {
        upstream = await startScriptedUpstream();
        proxy = await startProxy({ upstreamUrl: upstream.url, accounts, env: { ...FAST_RETRIES, ...SWITCH_AFTER } });
    });
    after(async () => {
        await proxy?.stop();
        await upstream?.close();
    });

    const RETRY_AFTER_S = 2;
    const accountsFile = () => JSON.parse(readFileSync(join(dirname(proxy.home), 'accounts.json'), 'utf8'));

    it('cools the account down for Retry-After and serves the request from another account', async () => {
        upstream.reset();
        upstream.enqueue({
            status: 429,
            headers: { 'retry-after': String(RETRY_AFTER_S) },
            json: { error: { code: 429, message: 'RESOURCE_EXHAUSTED' } }
        });
        const started = Date.now();
        const res = await postMessages(proxy.baseUrl);
        assert.equal(res.status, 200);
        await res.arrayBuffer();
        assert.deepEqual(tokensUsed(upstream), ['token-a', 'token-b']);

        await sleep(50); // the account store is written in the background
        const a = accountsFile().accounts.find(acc => acc.email === 'a@example.test');
        assert.equal(a.isRateLimited, true);
        const cooldown = a.rateLimitResetTime - started;
        assert.ok(
            cooldown >= RETRY_AFTER_S * 1000 - 100 && cooldown <= RETRY_AFTER_S * 1000 + 1000,
            `cooldown ${cooldown}ms`
        );

        const health = await (await fetch(`${proxy.baseUrl}/health`)).json();
        assert.equal(health.available, 1);
        assert.equal(health.rateLimited, 1);
        assert.equal(sample(await scrape(proxy.baseUrl), 'proxy_accounts{state="rate_limited"}'), 1);
    });

    it('sends the next request to the other account', async () => {
        upstream.reset();
        await (await postMessages(proxy.baseUrl)).arrayBuffer();
        assert.deepEqual(tokensUsed(upstream), ['token-b']);
    });

    it('brings the account back once the cooldown has passed', async () => {
        await sleep(RETRY_AFTER_S * 1000 + 200);
        const health = await (await fetch(`${proxy.baseUrl}/health`)).json();
        assert.equal(health.available, 2);
        assert.equal(health.rateLimited, 0);

        // When the current account is limited in turn, the recovered one serves the request
        upstream.reset();
        upstream.enqueue({
            status: 429,
            headers: { 'retry-after': '30' },
            json: { error: { code: 429, message: 'RESOURCE_EXHAUSTED' } }
        });
        const res = await postMessages(proxy.baseUrl);
        assert.equal(res.status, 200);
        await res.arrayBuffer();
        assert.deepEqual(tokensUsed(upstream), ['token-b', 'token-a']);
    });
});

describe('v2.12 plan item 2: cooldown expiry with a controlled clock', () => {
    let dir;
    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'plan-rotation-'));
    });
    after(async () => {
        mock.timers.reset();
        await sleep(20); // let background account-store writes settle
        rmSync(dir, { recursive: true, force: true });
    });

    it('keeps an account out for exactly the cooldown it was given', async () => {
        const path = join(dir, 'accounts.json');
        writeFileSync(path, JSON.stringify({ accounts, settings: {}, activeIndex: 0 }));
        const manager = new AccountManager(path);
        await manager.initialize();

        mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
        const cooldownMs = 10 * 60 * 1000; // longer than MAX_WAIT_BEFORE_ERROR: forces a switch
        manager.markRateLimited('a@example.test', cooldownMs);
        assert.equal(manager.getStatus().accounts[0].rateLimitResetTime, 1_000_000 + cooldownMs);
        assert.equal(manager.pickStickyAccount().account.email, 'b@example.test');

        mock.timers.tick(cooldownMs - 1);
        assert.equal(manager.clearExpiredLimits(), 0, 'still cooling down 1ms before the end');
        mock.timers.tick(1);
        assert.equal(manager.clearExpiredLimits(), 1);
        assert.equal(manager.getAvailableAccounts().length, 2);
    });
});

/**
 * A Cloud Code mock that reports a different remaining quota per account token.
 * @param {Record<string, number>} remainingByToken
 */
async function startQuotaUpstream(remainingByToken) {
    const used = [];
    const server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            const token = String(req.headers.authorization).replace('Bearer ', '');
            res.setHeader('content-type', 'application/json');
            if (req.url.startsWith('/v1internal:fetchAvailableModels')) {
                const remainingFraction = remainingByToken[token] ?? 1;
                res.end(JSON.stringify({ models: { 'gemini-3-flash': { quotaInfo: { remainingFraction } } } }));
                return;
            }
            used.push(token);
            res.end(
                JSON.stringify({
                    response: {
                        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
                        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
                    }
                })
            );
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        used,
        close: () => new Promise(resolve => server.close(() => resolve()))
    };
}

describe('v2.12 plan item 2: configurable rotation strategy', () => {
    /**
     * @param {string} strategy
     * @param {Record<string, number>} quotas
     * @param {number} requests
     * @returns {Promise<string[]>} Tokens used, in order
     */
    async function run(strategy, quotas, requests) {
        const upstream = await startQuotaUpstream(quotas);
        const proxy = await startProxy({ upstreamUrl: upstream.url, accounts, env: { ROTATION_STRATEGY: strategy } });
        try {
            for (let i = 0; i < requests; i++) await (await postMessages(proxy.baseUrl)).arrayBuffer();
            return [...upstream.used];
        } finally {
            await proxy.stop();
            await upstream.close();
        }
    }

    it(
        'round-robin spreads consecutive requests over the accounts',
        { todo: 'v2.12 plan item 2: ROTATION_STRATEGY=round-robin is not implemented (selection is always sticky)' },
        async () => {
            assert.deepEqual(await run('round-robin', {}, 4), ['token-a', 'token-b', 'token-a', 'token-b']);
        }
    );

    it(
        'least-used picks the account with the fewest requests',
        { todo: 'v2.12 plan item 2: ROTATION_STRATEGY=least-used is not implemented' },
        async () => {
            const used = await run('least-used', {}, 4);
            assert.equal(used.filter(t => t === 'token-a').length, 2);
            assert.equal(used.filter(t => t === 'token-b').length, 2);
        }
    );

    it(
        'quota-aware picks the account with the most remaining quota',
        { todo: 'v2.12 plan item 2: ROTATION_STRATEGY=quota-aware (pick by remaining quota) is not implemented' },
        async () => {
            assert.deepEqual(await run('quota-aware', { 'token-a': 0.1, 'token-b': 0.9 }, 2), ['token-b', 'token-b']);
        }
    );

    it(
        'rejects an unknown strategy at startup with a clear message',
        { todo: 'v2.12 plan item 2: ROTATION_STRATEGY is not validated' },
        async () => {
            const proxy = await spawnProxy({ env: { ROTATION_STRATEGY: 'random-ish' } });
            try {
                await sleep(200);
                assert.match(proxy.logs(), /ROTATION_STRATEGY.*round-robin\|least-used\|quota-aware/);
            } finally {
                await proxy.stop();
            }
        }
    );
});

// ---------------------------------------------------------------------------
// Plan item 3: record/replay conformance fixtures
// ---------------------------------------------------------------------------

describe('v2.12 plan item 3: record/replay conformance fixtures', () => {
    it(
        '--record writes upstream exchanges as fixtures with secrets redacted',
        { todo: 'v2.12 plan item 3: there is no --record mode' },
        async () => {
            const upstream = await startScriptedUpstream();
            const recordDir = mkdtempSync(join(tmpdir(), 'plan-record-'));
            const proxy = await spawnProxy({ args: ['--record', recordDir], upstreamUrl: upstream.url });
            try {
                await (await postMessages(proxy.baseUrl)).arrayBuffer();
                const files = readdirSync(recordDir).filter(f => f.endsWith('.json'));
                assert.ok(files.length >= 1, 'a fixture was recorded');
                const recorded = readFileSync(join(recordDir, files[0]), 'utf8');
                assert.ok(
                    !recorded.includes('token-a') && !recorded.includes('test-client-secret'),
                    'secrets redacted'
                );
                assert.match(recorded, /\[REDACTED\]/);
                const fixture = JSON.parse(recorded);
                assert.ok(fixture.request && fixture.upstream, 'fixture has the request and the upstream exchange');
            } finally {
                await proxy.stop();
                await upstream.close();
                rmSync(recordDir, { recursive: true, force: true });
            }
        }
    );

    it(
        'recorded fixtures are replayed by the conformance suite',
        { todo: 'v2.12 plan item 3: no recorded fixtures or replay harness yet (fixtures are synthetic)' },
        async () => {
            const recordedDir = join(PACKAGE_ROOT, 'test', 'fixtures', 'recorded');
            assert.ok(existsSync(recordedDir), 'test/fixtures/recorded exists');
            assert.ok(
                readdirSync(recordedDir).some(f => f.endsWith('.json')),
                'at least one recorded fixture'
            );
            const replay = await import(pathToFileURL(join(PACKAGE_ROOT, 'test', 'helpers', 'replay.mjs')).href);
            assert.equal(typeof replay.replayFixture, 'function');
        }
    );
});

// ---------------------------------------------------------------------------
// Plan items 4 and 5: CI workflows
// ---------------------------------------------------------------------------

describe('v2.12 plan items 4 and 5: CI workflows', () => {
    it('finds the repository workflows to check', () => {
        assert.ok(readWorkflows().length > 0, 'no .github/workflows/*.yml found');
    });

    it(
        'publishes a multi-arch image to GHCR with SBOM and provenance',
        { todo: 'v2.12 plan item 4: no GHCR multi-arch publish workflow yet' },
        () => {
            const publishing = readWorkflows().filter(
                w => /ghcr\.io/.test(w.text) && /^\s*push:\s*true\b/m.test(w.text)
            );
            assert.ok(publishing.length > 0, 'a workflow pushes to ghcr.io');
            const { text } = publishing[0];
            assert.match(text, /docker\/setup-qemu-action/);
            assert.match(text, /docker\/setup-buildx-action/);
            assert.match(
                text,
                /platforms:\s*\S*linux\/amd64\S*linux\/arm64|platforms:\s*\S*linux\/arm64\S*linux\/amd64/
            );
            assert.match(text, /^\s*sbom:\s*true\b/m);
            assert.match(text, /^\s*provenance:\s*(true|mode=max)\b/m);
            assert.match(text, /^\s*packages:\s*write\b/m);
        }
    );

    it('runs the offline smoke tests on Windows', { todo: 'v2.12 plan item 5: no Windows smoke CI job yet' }, () => {
        const windows = readWorkflows().filter(
            w =>
                /runs-on:\s*\$?\{?\{?[^\n]*windows-(latest|20\d\d)/.test(w.text) || /os:\s*\[[^\]]*windows/.test(w.text)
        );
        assert.ok(windows.length > 0, 'a job runs on windows');
        assert.ok(
            windows.some(w => /npm (test|run test)|tests\/smoke/.test(w.text)),
            'the Windows job runs the smoke tests'
        );
    });
});
