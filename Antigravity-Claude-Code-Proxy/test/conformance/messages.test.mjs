/**
 * Anthropic Messages API conformance suite.
 *
 * Replays every JSON fixture in test/fixtures/conformance against the real proxy
 * process, which talks to a scripted mock Cloud Code upstream. Fixtures are
 * synthetic; no provider credentials or network access are used.
 *
 * Fixture fields: request {body | rawBody, headers}, upstream [steps], expect {status,
 * headers, body, events, eventData, upstreamCalls, upstreamRequest, upstreamContains,
 * upstreamNotContains, upstreamHeaders, upstreamHeadersAbsent, minElapsedMs, maxElapsedMs}.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProxy, FAKE_ACCESS_TOKEN, FAKE_PROJECT_ID } from '../../tests/smoke/helpers.mjs';
import { startScriptedUpstream } from '../helpers/scripted-upstream.mjs';
import { assertMatches, parseSse } from '../helpers/match.mjs';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'conformance');
const fixtures = readdirSync(FIXTURE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')));

const PROFILES = {
    default: {
        UPSTREAM_RETRIES: '2',
        RETRY_BASE_MS: '5',
        RETRY_MAX_MS: '20',
        REQUEST_TIMEOUT: '3000',
        AUTO_WAIT_FOR_RATE_LIMIT: 'false',
        MAX_WAIT_BEFORE_ERROR: '1000'
    },
    strict: {
        UPSTREAM_RETRIES: '0',
        REQUEST_TIMEOUT: '800',
        RATE_LIMIT_STATUS: '429',
        REQUEST_BODY_LIMIT: '2kb',
        AUTO_WAIT_FOR_RATE_LIMIT: 'false',
        MAX_WAIT_BEFORE_ERROR: '1000'
    }
};

const account = { email: 'mock-account', source: 'manual', apiKey: FAKE_ACCESS_TOKEN, projectId: FAKE_PROJECT_ID };

for (const [profile, env] of Object.entries(PROFILES)) {
    const cases = fixtures.filter(f => f.profile === profile);

    describe(`conformance (${profile} profile)`, () => {
        let upstream;
        let proxy;

        before(async () => {
            upstream = await startScriptedUpstream();
            proxy = await startProxy({ upstreamUrl: upstream.url, accounts: [account], env });
        });

        after(async () => {
            await proxy?.stop();
            await upstream?.close();
        });

        for (const fx of cases) {
            it(`${fx.name}: ${fx.description}`, async () => {
                upstream.reset();
                upstream.enqueue(...fx.upstream);

                const headers = { 'content-type': 'application/json', ...fx.request.headers };
                const body = fx.request.rawBody ?? JSON.stringify(fx.request.body);
                const started = Date.now();
                const res = await fetch(`${proxy.baseUrl}/v1/messages`, {
                    method: 'POST',
                    headers,
                    body,
                    signal: AbortSignal.timeout(15000)
                });
                const text = await res.text();
                const elapsed = Date.now() - started;
                const exp = fx.expect;
                const context = `\n--- response ---\n${text}\n--- proxy log tail ---\n${proxy.logs().slice(-2000)}`;

                assert.equal(res.status, exp.status, `status${context}`);
                for (const [name, value] of Object.entries(exp.headers ?? {})) {
                    assertMatches(res.headers.get(name), value, `header ${name}`);
                }
                if (exp.body) assertMatches(JSON.parse(text), exp.body, 'body');
                if (exp.events) {
                    const events = parseSse(text);
                    assert.deepEqual(
                        events.map(e => e.event),
                        exp.events,
                        `event order${context}`
                    );
                    for (const e of events) assert.equal(e.data?.type, e.event, 'event name matches data.type');
                    (exp.eventData ?? []).forEach((expected, i) =>
                        assertMatches(events[i].data, expected, `event[${i}]`)
                    );
                }

                assert.deepEqual(
                    upstream.requests.map(r => r.url),
                    exp.upstreamCalls,
                    `upstream calls${context}`
                );
                const first = upstream.requests[0];
                if (exp.upstreamRequest) assertMatches(first.body, exp.upstreamRequest, 'upstream body');
                for (const needle of exp.upstreamContains ?? []) {
                    assert.ok(JSON.stringify(first.body).includes(needle), `upstream body should contain ${needle}`);
                }
                for (const needle of exp.upstreamNotContains ?? []) {
                    assert.ok(!JSON.stringify(first.body).includes(needle), `upstream body must not contain ${needle}`);
                }
                for (const [name, value] of Object.entries(exp.upstreamHeaders ?? {})) {
                    assertMatches(first.headers[name], value, `upstream header ${name}`);
                }
                for (const name of exp.upstreamHeadersAbsent ?? []) {
                    assert.equal(first.headers[name], undefined, `upstream header ${name} must not be forwarded`);
                }
                if (exp.minElapsedMs) assert.ok(elapsed >= exp.minElapsedMs, `took ${elapsed}ms`);
                if (exp.maxElapsedMs) assert.ok(elapsed <= exp.maxElapsedMs, `took ${elapsed}ms`);
                assert.equal(upstream.pending(), 0, 'every scripted upstream step should be consumed');
            });
        }
    });
}
