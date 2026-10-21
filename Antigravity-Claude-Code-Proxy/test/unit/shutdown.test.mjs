/**
 * Unit tests for graceful shutdown: drain in-flight work, force-close on timeout.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGracefulShutdown } from '../../src/http/shutdown.js';

/** Fake http.Server whose close() completes when finish() is called. */
function fakeServer() {
    const s = new EventEmitter();
    s.closed = false;
    s.idleClosed = 0;
    s.allClosed = 0;
    s.close = cb => {
        s.closed = true;
        s.finish = () => cb?.();
    };
    s.closeIdleConnections = () => s.idleClosed++;
    s.closeAllConnections = () => {
        s.allClosed++;
        s.finish?.();
    };
    return s;
}

describe('createGracefulShutdown', () => {
    it('stops accepting, waits for in-flight requests, then exits 0', async () => {
        const server = fakeServer();
        const exits = [];
        const shutdown = createGracefulShutdown({
            getServers: () => [server],
            timeoutMs: 1000,
            exit: code => exits.push(code),
            log: () => {}
        });
        assert.equal(shutdown.isDraining(), false);
        const done = shutdown.run('SIGTERM');
        assert.equal(shutdown.isDraining(), true);
        assert.equal(server.closed, true);
        assert.equal(server.idleClosed, 1);
        assert.deepEqual(exits, []);
        server.finish();
        await done;
        assert.deepEqual(exits, [0]);
        assert.equal(server.allClosed, 0);
    });

    it('force-closes remaining connections after the timeout and exits 1', async () => {
        const server = fakeServer();
        server.closeAllConnections = () => server.allClosed++; // connections refuse to finish
        const exits = [];
        const shutdown = createGracefulShutdown({
            getServers: () => [server],
            timeoutMs: 20,
            exit: code => exits.push(code),
            log: () => {}
        });
        await shutdown.run('SIGINT');
        assert.equal(server.allClosed, 1);
        assert.deepEqual(exits, [1]);
    });

    it('a second signal while draining forces an immediate exit', async () => {
        const server = fakeServer();
        server.closeAllConnections = () => server.allClosed++;
        let closes = 0;
        const origClose = server.close;
        server.close = cb => {
            closes++;
            origClose(cb);
        };
        const exits = [];
        const shutdown = createGracefulShutdown({
            getServers: () => [server],
            timeoutMs: 60_000, // only the forced path can finish within the test
            exit: code => exits.push(code),
            log: () => {}
        });
        const first = shutdown.run('SIGTERM');
        await shutdown.run('SIGINT');
        assert.equal(closes, 1, 'servers are closed once');
        assert.equal(server.allClosed, 1);
        assert.deepEqual(exits, [1]);
        server.finish();
        await first;
    });

    it('keeps closing connections that become idle during the drain', async () => {
        const server = fakeServer();
        const shutdown = createGracefulShutdown({
            getServers: () => [server],
            timeoutMs: 2000,
            idleSweepMs: 10,
            exit: () => {},
            log: () => {}
        });
        const done = shutdown.run('SIGTERM');
        await new Promise(r => setTimeout(r, 60));
        assert.ok(server.idleClosed >= 3, `idle sweeps: ${server.idleClosed}`);
        server.finish();
        await done;
        const after = server.idleClosed;
        await new Promise(r => setTimeout(r, 40));
        assert.equal(server.idleClosed, after, 'sweeping stops after shutdown');
    });

    it('runs the onDrained hook before exiting and tolerates servers that are not listening', async () => {
        const server = fakeServer();
        server.close = cb => cb(Object.assign(new Error('Server is not running.'), { code: 'ERR_SERVER_NOT_RUNNING' }));
        const order = [];
        const shutdown = createGracefulShutdown({
            getServers: () => [server, null],
            timeoutMs: 1000,
            onDrained: async () => order.push('drained'),
            exit: code => order.push(`exit ${code}`),
            log: () => {}
        });
        await shutdown.run('SIGTERM');
        assert.deepEqual(order, ['drained', 'exit 0']);
    });
});
