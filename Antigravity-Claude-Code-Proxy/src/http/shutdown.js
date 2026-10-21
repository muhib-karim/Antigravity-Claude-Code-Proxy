// @ts-check
/**
 * Graceful shutdown: stop accepting connections, let in-flight requests (including
 * long SSE streams) finish, then exit. After `timeoutMs` the remaining sockets are
 * destroyed and the process exits with code 1.
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
 * @property {() => Promise<void> | void} [onDrained] - Flush state before exit
 * @property {(code: number) => void} [exit=process.exit]
 * @property {(message: string) => void} [log=console.log]
 */

/**
 * @param {ShutdownOptions} options
 * @returns {{run: (signal: string) => Promise<void>, isDraining: () => boolean}}
 */
export function createGracefulShutdown({ getServers, timeoutMs, onDrained, exit = process.exit, log = console.log }) {
    /** @type {Promise<void> | null} */
    let running = null;

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
        const servers = /** @type {ClosableServer[]} */ (getServers().filter(Boolean));

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        const timedOut = new Promise(resolve => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const outcome = await Promise.race([Promise.all(servers.map(closeServer)).then(() => 'drained'), timedOut]);
        clearTimeout(timer);

        if (outcome === 'timeout') {
            log('[Server] Drain deadline reached; closing remaining connections');
            for (const server of servers) server.closeAllConnections?.();
        }
        try {
            await onDrained?.();
        } catch (error) {
            log(`[Server] Error while flushing state: ${/** @type {Error} */ (error).message}`);
        }
        log(`[Server] Shutdown complete (${outcome})`);
        exit(outcome === 'drained' ? 0 : 1);
    }

    return {
        run: signal => (running ??= shutdown(signal)),
        isDraining: () => running !== null
    };
}
