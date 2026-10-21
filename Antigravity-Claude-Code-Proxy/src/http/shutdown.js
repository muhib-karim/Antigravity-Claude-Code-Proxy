// @ts-check
/**
 * Graceful shutdown: stop accepting connections, let in-flight requests (including
 * long SSE streams) finish, then exit. After `timeoutMs` the remaining sockets are
 * destroyed and the process exits with code 1. A second signal while draining forces
 * an immediate exit (code 1).
 */

/**
 * @typedef {object} ClosableServer
 * @property {(cb?: (err?: Error) => void) => unknown} close
 * @property {() => void} [closeIdleConnections]
 * @property {() => void} [closeAllConnections]
 *
 * @typedef {object} ShutdownOptions
 * @property {() => Array<ClosableServer | null | undefined>} getServers - Listening servers (nulls ignored)
 * @property {number} timeoutMs - Drain deadline
 * @property {number} [idleSweepMs=250] - How often keep-alive sockets that went idle during the drain are closed
 * @property {() => Promise<void> | void} [onDrained] - Flush state before exit
 * @property {(code: number) => void} [exit=process.exit]
 * @property {(message: string) => void} [log=console.log]
 */

/**
 * @param {ShutdownOptions} options
 * @returns {{run: (signal: string) => Promise<void>, isDraining: () => boolean}}
 */
export function createGracefulShutdown({
    getServers,
    timeoutMs,
    idleSweepMs = 250,
    onDrained,
    exit = process.exit,
    log = console.log
}) {
    /** @type {Promise<void> | null} */
    let running = null;
    let exited = false;

    /** @param {number} code */
    const exitOnce = code => {
        if (exited) return;
        exited = true;
        exit(code);
    };

    const servers = () => /** @type {ClosableServer[]} */ (getServers().filter(Boolean));

    /**
     * @param {ClosableServer} server
     * @returns {Promise<void>}
     */
    const closeServer = server =>
        new Promise(resolve => {
            server.close(err => {
                if (err && /** @type {any} */ (err).code !== 'ERR_SERVER_NOT_RUNNING') {
                    log(`[Server] Error closing server: ${err.message}`);
                }
                resolve();
            });
            // Keep-alive sockets with no request in flight would otherwise hold close() open
            server.closeIdleConnections?.();
        });

    /**
     * @param {string} signal
     * @returns {Promise<void>}
     */
    async function shutdown(signal) {
        log(`[Server] ${signal} received. Draining in-flight requests (up to ${timeoutMs}ms)...`);
        const listening = servers();
        // Node only closes idle keep-alive sockets when close() is called; responses that finish
        // during the drain would otherwise keep their sockets (and the drain) open
        const sweep = setInterval(() => {
            for (const server of listening) server.closeIdleConnections?.();
        }, idleSweepMs);

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        const timedOut = new Promise(resolve => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const outcome = await Promise.race([Promise.all(listening.map(closeServer)).then(() => 'drained'), timedOut]);
        clearTimeout(timer);
        clearInterval(sweep);

        if (outcome === 'timeout') {
            log('[Server] Drain deadline reached; closing remaining connections');
            for (const server of listening) server.closeAllConnections?.();
        }
        try {
            await onDrained?.();
        } catch (error) {
            log(`[Server] Error while flushing state: ${/** @type {Error} */ (error).message}`);
        }
        log(`[Server] Shutdown complete (${outcome})`);
        exitOnce(outcome === 'drained' ? 0 : 1);
    }

    /**
     * @param {string} signal
     * @returns {Promise<void>}
     */
    function forceExit(signal) {
        log(`[Server] ${signal} received again; forcing exit`);
        for (const server of servers()) server.closeAllConnections?.();
        exitOnce(1);
        return Promise.resolve();
    }

    return {
        run: signal => (running ? forceExit(signal) : (running = shutdown(signal))),
        isDraining: () => running !== null
    };
}
