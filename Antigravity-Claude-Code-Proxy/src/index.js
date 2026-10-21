/**
 * Antigravity Claude Proxy
 * Entry point - starts the proxy server
 */

// Must stay the first import: tokens, API keys and cookies never reach stdout/stderr
import './utils/install-redaction.js';
import app from './server.js';
import { DEFAULT_PORT, DEFAULT_HOST, SHUTDOWN_TIMEOUT_MS } from './constants.js';
import { createGracefulShutdown } from './http/shutdown.js';

const PORT = process.env.PORT || DEFAULT_PORT;
const HOST = DEFAULT_HOST;

// Track server instances for graceful shutdown
let server = null;
let server6 = null; // optional IPv6 loopback listener (see below)

// Stop accepting connections, let in-flight requests and SSE streams finish (up to
// SHUTDOWN_TIMEOUT), then exit. While draining, /readyz and new requests answer 503.
const shutdown = createGracefulShutdown({
    getServers: () => [server, server6],
    timeoutMs: SHUTDOWN_TIMEOUT_MS
});
app.locals.isDraining = shutdown.isDraining;

/**
 * Bound how long a client may take to send its request, so idle or slow sockets
 * cannot pin the process. Response streaming is not affected.
 * @param {import('http').Server} srv
 */
function applyServerTimeouts(srv) {
    srv.headersTimeout = 30000;
    srv.requestTimeout = 120000;
    srv.keepAliveTimeout = 65000;
}

// Handle termination signals
process.on('SIGTERM', () => shutdown.run('SIGTERM'));
process.on('SIGINT', () => shutdown.run('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught exception:', error);
    shutdown.run('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejections, just log them
});

// When bound to the IPv4 loopback, also listen on the IPv6 loopback so clients
// that resolve "localhost" to ::1 can still connect. Skipped if IPv6 is unavailable.
if (HOST === '127.0.0.1') {
    server6 = app.listen(PORT, '::1');
    applyServerTimeouts(server6);
    server6.on('error', (error) => {
        server6 = null;
        if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') return;
        console.error(`[Server] Could not listen on [::1]:${PORT} (${error.code || error.message}).`);
        console.error('[Server] Another program may be using this port; clients that resolve localhost to ::1 will not reach the proxy.');
    });
}

server = app.listen(PORT, HOST, () => {
    applyServerTimeouts(server);
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           Antigravity Claude Proxy Server                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Server running at: http://localhost:${PORT}                   ║
║  ${`Listening on: ${HOST}`.padEnd(60)}║
║                                                              ║
║  Endpoints:                                                  ║
║    POST /v1/messages  - Anthropic Messages API               ║
║    GET  /v1/models    - List available models                ║
║    GET  /health       - Health check                         ║
║    GET  /livez /readyz /metrics - Probes and Prometheus      ║
║    GET  /account-limits - Account status & quotas              ║
║    POST /refresh-token - Force token refresh                 ║
║                                                              ║
║  Usage with Claude Code:                                     ║
║    export ANTHROPIC_BASE_URL=http://localhost:${PORT}          ║
║    export ANTHROPIC_API_KEY=dummy                            ║
║    claude                                                    ║
║                                                              ║
║  Add Google accounts:                                        ║
║    npm run accounts                                          ║
║                                                              ║
║  Prerequisites (if no accounts configured):                  ║
║    - Antigravity must be running                             ║
║    - Have a chat panel open in Antigravity                   ║
║                                                              ║
║  Press Ctrl+C to stop the server gracefully                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
