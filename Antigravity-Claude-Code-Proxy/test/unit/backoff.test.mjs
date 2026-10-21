/**
 * Unit tests for the retry/backoff primitives used for upstream calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackoff, parseRetryAfter, retryDelay, retry } from '../../src/resilience/backoff.js';

describe('computeBackoff', () => {
    it('grows exponentially without jitter', () => {
        const opts = { baseMs: 100, maxMs: 10_000, factor: 2, jitter: 'none' };
        assert.deepEqual(
            [0, 1, 2, 3].map(a => computeBackoff(a, opts)),
            [100, 200, 400, 800]
        );
    });

    it('is capped at maxMs', () => {
        assert.equal(computeBackoff(20, { baseMs: 100, maxMs: 5000, jitter: 'none' }), 5000);
    });

    it('full jitter stays within [0, exponential delay]', () => {
        const opts = { baseMs: 100, maxMs: 10_000, jitter: 'full' };
        assert.equal(computeBackoff(3, { ...opts, random: () => 0 }), 0);
        assert.equal(computeBackoff(3, { ...opts, random: () => 0.5 }), 400);
        assert.ok(computeBackoff(3, { ...opts, random: () => 0.999999 }) < 800);
    });

    it('equal jitter keeps at least half of the delay', () => {
        const opts = { baseMs: 100, maxMs: 10_000, jitter: 'equal' };
        assert.equal(computeBackoff(2, { ...opts, random: () => 0 }), 200);
        assert.equal(computeBackoff(2, { ...opts, random: () => 0.5 }), 300);
    });

    it('defaults to full jitter with Math.random', () => {
        for (let i = 0; i < 50; i++) {
            const d = computeBackoff(1);
            assert.ok(d >= 0 && d <= 1000, `delay ${d}`);
        }
    });

    it('rejects a negative attempt', () => {
        assert.throws(() => computeBackoff(-1), RangeError);
    });
});

describe('parseRetryAfter', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');

    it('parses delta-seconds', () => {
        assert.equal(parseRetryAfter('120', now), 120_000);
        assert.equal(parseRetryAfter(' 0 ', now), 0);
    });

    it('parses an HTTP-date relative to now', () => {
        assert.equal(parseRetryAfter('Wed, 21 Oct 2026 12:00:30 GMT', now), 30_000);
    });

    it('clamps a date in the past to zero', () => {
        assert.equal(parseRetryAfter('Wed, 21 Oct 2026 11:00:00 GMT', now), 0);
    });

    it('returns null for missing or invalid values', () => {
        for (const v of [null, undefined, '', 'soon', '-5', '1.5e3x']) {
            assert.equal(parseRetryAfter(v, now), null, String(v));
        }
    });
});

describe('retryDelay', () => {
    const opts = { baseMs: 100, maxMs: 1000, jitter: 'none' };

    it('uses the backoff when there is no retry-after', () => {
        assert.equal(retryDelay(1, null, opts), 200);
    });

    it('honours a retry-after that is longer than the backoff', () => {
        assert.equal(retryDelay(0, 750, opts), 750);
    });

    it('never waits less than the backoff', () => {
        assert.equal(retryDelay(2, 10, opts), 400);
    });

    it('caps retry-after at maxRetryAfterMs', () => {
        assert.equal(retryDelay(0, 60_000, { ...opts, maxRetryAfterMs: 5000 }), 5000);
    });
});

describe('retry', () => {
    const noSleep = async () => {};

    it('returns the first successful result', async () => {
        let calls = 0;
        const result = await retry(
            async () => {
                calls++;
                if (calls < 3) throw Object.assign(new Error('boom'), { retryable: true });
                return 'ok';
            },
            { retries: 3, sleep: noSleep }
        );
        assert.equal(result, 'ok');
        assert.equal(calls, 3);
    });

    it('gives up after `retries` extra attempts and rethrows the last error', async () => {
        let calls = 0;
        await assert.rejects(
            retry(
                async () => {
                    calls++;
                    throw Object.assign(new Error(`fail ${calls}`), { retryable: true });
                },
                { retries: 2, sleep: noSleep }
            ),
            /fail 3/
        );
        assert.equal(calls, 3);
    });

    it('does not retry errors that shouldRetry rejects', async () => {
        let calls = 0;
        await assert.rejects(
            retry(
                async () => {
                    calls++;
                    throw new Error('bad request');
                },
                { retries: 5, sleep: noSleep, shouldRetry: () => false }
            ),
            /bad request/
        );
        assert.equal(calls, 1);
    });

    it('sleeps for the retry-after carried by the error and reports each retry', async () => {
        const slept = [];
        const seen = [];
        let calls = 0;
        await retry(
            async () => {
                if (calls++ === 0) throw Object.assign(new Error('busy'), { retryable: true, retryAfterMs: 900 });
                return 'ok';
            },
            {
                retries: 1,
                baseMs: 10,
                jitter: 'none',
                sleep: async ms => slept.push(ms),
                onRetry: info => seen.push(info)
            }
        );
        assert.deepEqual(slept, [900]);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].attempt, 1);
        assert.equal(seen[0].delayMs, 900);
        assert.equal(seen[0].error.message, 'busy');
    });

    it('treats errors without a retryable flag as final by default', async () => {
        let calls = 0;
        await assert.rejects(
            retry(
                async () => {
                    calls++;
                    throw new Error('plain');
                },
                { retries: 3, sleep: noSleep }
            )
        );
        assert.equal(calls, 1);
    });
});
