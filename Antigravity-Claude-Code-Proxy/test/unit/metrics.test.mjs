/**
 * Unit tests for the dependency-free Prometheus registry behind GET /metrics.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, createMetricsMiddleware } from '../../src/http/metrics.js';

describe('Registry', () => {
    it('renders counters with HELP/TYPE lines and labels', () => {
        const r = new Registry();
        const c = r.counter('demo_total', 'Demo counter', ['route']);
        c.inc({ route: '/a' });
        c.inc({ route: '/a' }, 2);
        c.inc({ route: '/b' });
        const text = r.render();
        assert.match(text, /^# HELP demo_total Demo counter$/m);
        assert.match(text, /^# TYPE demo_total counter$/m);
        assert.match(text, /^demo_total\{route="\/a"\} 3$/m);
        assert.match(text, /^demo_total\{route="\/b"\} 1$/m);
    });

    it('renders an unlabelled counter as 0 before any increment', () => {
        const r = new Registry();
        r.counter('zero_total', 'Never incremented');
        assert.match(r.render(), /^zero_total 0$/m);
    });

    it('rejects negative counter increments and unknown labels', () => {
        const c = new Registry().counter('x_total', 'x', ['a']);
        assert.throws(() => c.inc({ a: '1' }, -1), RangeError);
        assert.throws(() => c.inc({ b: '1' }), /unknown label/);
    });

    it('escapes label values', () => {
        const r = new Registry();
        r.counter('esc_total', 'Escaping', ['v']).inc({ v: 'a"b\\c\nd' });
        assert.match(r.render(), /esc_total\{v="a\\"b\\\\c\\nd"\} 1/);
    });

    it('renders gauges from set() and from collectors', () => {
        const r = new Registry();
        r.gauge('g_set', 'Set gauge').set({}, 4.5);
        r.gauge('g_fn', 'Collected gauge', ['state'], () => [
            { labels: { state: 'ok' }, value: 2 },
            { labels: { state: 'bad' }, value: 0 }
        ]);
        const text = r.render();
        assert.match(text, /^# TYPE g_set gauge$/m);
        assert.match(text, /^g_set 4.5$/m);
        assert.match(text, /^g_fn\{state="ok"\} 2$/m);
        assert.match(text, /^g_fn\{state="bad"\} 0$/m);
    });

    it('renders cumulative histogram buckets, sum and count', () => {
        const r = new Registry();
        const h = r.histogram('lat_seconds', 'Latency', ['route'], [0.1, 1]);
        h.observe({ route: '/x' }, 0.05);
        h.observe({ route: '/x' }, 0.5);
        h.observe({ route: '/x' }, 3);
        const text = r.render();
        assert.match(text, /^# TYPE lat_seconds histogram$/m);
        assert.match(text, /^lat_seconds_bucket\{route="\/x",le="0.1"\} 1$/m);
        assert.match(text, /^lat_seconds_bucket\{route="\/x",le="1"\} 2$/m);
        assert.match(text, /^lat_seconds_bucket\{route="\/x",le="\+Inf"\} 3$/m);
        assert.match(text, /^lat_seconds_sum\{route="\/x"\} 3.55$/m);
        assert.match(text, /^lat_seconds_count\{route="\/x"\} 3$/m);
    });

    it('refuses duplicate metric names', () => {
        const r = new Registry();
        r.counter('dup_total', 'a');
        assert.throws(() => r.gauge('dup_total', 'b'), /already registered/);
    });
});

describe('createMetricsMiddleware', () => {
    it('records method, matched route and status when the response finishes', () => {
        const r = new Registry();
        const requests = r.counter('req_total', 'r', ['method', 'route', 'status']);
        const duration = r.histogram('req_seconds', 'd', ['method', 'route'], [1]);
        const mw = createMetricsMiddleware({ requests, duration });
        const listeners = {};
        const req = { method: 'POST', baseUrl: '', route: { path: '/v1/messages' } };
        const res = { statusCode: 200, on: (ev, fn) => (listeners[ev] = fn) };
        let nextCalled = false;
        mw(req, res, () => (nextCalled = true));
        assert.ok(nextCalled);
        listeners.finish();
        const text = r.render();
        assert.match(text, /req_total\{method="POST",route="\/v1\/messages",status="200"\} 1/);
        assert.match(text, /req_seconds_count\{method="POST",route="\/v1\/messages"\} 1/);
    });

    it('counts requests the client aborted before the response finished', () => {
        const r = new Registry();
        const requests = r.counter('req_total', 'r', ['method', 'route', 'status']);
        const duration = r.histogram('req_seconds', 'd', ['method', 'route'], [1]);
        const listeners = {};
        const res = { statusCode: 200, writableFinished: false, on: (ev, fn) => (listeners[ev] = fn) };
        createMetricsMiddleware({ requests, duration })(
            { method: 'POST', route: { path: '/v1/messages' } },
            res,
            () => {}
        );
        listeners.close();
        assert.match(r.render(), /req_total\{method="POST",route="\/v1\/messages",status="aborted"\} 1/);
    });

    it('records a finished request once even though close also fires', () => {
        const r = new Registry();
        const requests = r.counter('req_total', 'r', ['method', 'route', 'status']);
        const duration = r.histogram('req_seconds', 'd', ['method', 'route'], [1]);
        const listeners = {};
        const res = { statusCode: 201, writableFinished: true, on: (ev, fn) => (listeners[ev] = fn) };
        createMetricsMiddleware({ requests, duration })({ method: 'GET', route: { path: '/x' } }, res, () => {});
        listeners.finish();
        listeners.close();
        assert.match(r.render(), /req_total\{method="GET",route="\/x",status="201"\} 1/);
    });

    it('labels unmatched paths as "unmatched" to keep cardinality bounded', () => {
        const r = new Registry();
        const requests = r.counter('req_total', 'r', ['method', 'route', 'status']);
        const duration = r.histogram('req_seconds', 'd', ['method', 'route'], [1]);
        const listeners = {};
        createMetricsMiddleware({ requests, duration })(
            { method: 'GET', originalUrl: '/random/123' },
            { statusCode: 404, on: (ev, fn) => (listeners[ev] = fn) },
            () => {}
        );
        listeners.finish();
        assert.match(r.render(), /route="unmatched",status="404"/);
    });
});
