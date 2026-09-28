/**
 * Antigravity Claude Proxy
 * Entry point - starts the proxy server
 */

import app from './server.js';
import { DEFAULT_PORT, DEFAULT_HOST } from './constants.js';

const PORT = process.env.PORT || DEFAULT_PORT;
const HOST = DEFAULT_HOST;

// Track server instances for graceful shutdown
let server = null;
let server6 = null; // optional IPv6 loopback listener (see below)
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 * Drains active connections and saves state before exit
 * @param {string} signal - The signal that triggered shutdown
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('[Server] Shutdown already in progress...');
        return;
    }
    isShuttingDown = true;

    console.log(`\n[Server] ${signal} received. Starting graceful shutdown...`);

    // Give in-flight requests time to complete
    const shutdownTimeout = 30000; // 30 seconds
    const forceExitTimeout = setTimeout(() => {
        console.log('[Server] Force shutdown after timeout');
        process.exit(1);
    }, shutdownTimeout);

    try {
        // Stop accepting new connections and wait for in-flight requests on both listeners
        const closing = [server, server6].filter(Boolean).map(srv => new Promise((resolve, reject) => {
            srv.close((err) => {
                if (err) {
                    console.log('[Server] Error closing server:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        }));
        await Promise.all(closing);
        console.log('[Server] Server closed, no longer accepting connections');

        // Allow time for any pending async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('[Server] Graceful shutdown complete');
        clearTimeout(forceExitTimeout);
        process.exit(0);
    } catch (error) {
        console.error('[Server] Error during shutdown:', error.message);
        clearTimeout(forceExitTimeout);
        process.exit(1);
    }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejections, just log them
});

// When bound to the IPv4 loopback, also listen on the IPv6 loopback so clients
// that resolve "localhost" to ::1 can still connect. Skipped if IPv6 is unavailable.
if (HOST === '127.0.0.1') {
    server6 = app.listen(PORT, '::1');
    server6.on('error', (error) => {
        server6 = null;
        if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') return;
        console.error(`[Server] Could not listen on [::1]:${PORT} (${error.code || error.message}).`);
        console.error('[Server] Another program may be using this port; clients that resolve localhost to ::1 will not reach the proxy.');
    });
}

server = app.listen(PORT, HOST, () => {
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
