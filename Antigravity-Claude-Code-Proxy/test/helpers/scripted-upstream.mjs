/**
 * A scripted mock of the Cloud Code upstream for conformance tests.
 *
 * Each incoming request consumes the next queued step; when the queue is empty a
 * plain "ok" text reply is sent. Steps (all fields optional):
 *   { status, headers, json }              JSON reply (default status 200)
 *   { sse: [chunk, ...], chunkDelayMs }    text/event-stream reply, one `data:` line per chunk
 *   { sse: [...], destroy: true }          send the chunks, then drop the connection mid-stream
 *   { hang: true }                         accept the request and never answer
 *   { delayMs }                            wait before answering
 */
import http from 'node:http';

const DEFAULT_STEP = {
    json: {
        response: {
            candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
        }
    }
};

/**
 * @returns {Promise<{url: string, requests: object[], enqueue: (...steps: object[]) => void, reset: () => void, pending: () => number, close: () => Promise<void>}>}
 */
export async function startScriptedUpstream() {
    const queue = [];
    const requests = [];
    const sockets = new Set();

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', async () => {
            let json = null;
            try {
                json = JSON.parse(body);
            } catch {
                /* not JSON */
            }
            requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });

            const step = queue.shift() ?? DEFAULT_STEP;
            if (step.hang) return;
            if (step.delayMs) await new Promise(r => setTimeout(r, step.delayMs));

            if (step.sse) {
                res.writeHead(step.status ?? 200, { 'content-type': 'text/event-stream', ...step.headers });
                for (const chunk of step.sse) {
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    if (step.chunkDelayMs) await new Promise(r => setTimeout(r, step.chunkDelayMs));
                }
                if (step.destroy) {
                    // Give the proxy a moment to read the chunks, then cut the socket
                    await new Promise(r => setTimeout(r, 50));
                    res.socket?.destroy();
                    return;
                }
                res.end();
                return;
            }
            res.writeHead(step.status ?? 200, { 'content-type': 'application/json', ...step.headers });
            res.end(JSON.stringify(step.json ?? {}));
        });
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        requests,
        enqueue: (...steps) => queue.push(...steps),
        reset: () => {
            queue.length = 0;
            requests.length = 0;
        },
        pending: () => queue.length,
        close: () =>
            new Promise(resolve => {
                for (const s of sockets) s.destroy();
                server.close(() => resolve());
            })
    };
}
