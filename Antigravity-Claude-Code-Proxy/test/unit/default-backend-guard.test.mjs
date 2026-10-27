/**
 * The guard preloaded into spawned test proxies refuses requests to the default Perplexity
 * backend in-process, so no test can reach a backend a developer runs on port 8000.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { defaultBackendGuardEnv } from '../../tests/smoke/helpers.mjs';

const PROBE = `
for (const url of ['http://localhost:8000/stats', 'http://127.0.0.1:8000/v1/chat/completions', 'http://[::1]:8000/']) {
    try {
        await fetch(url, { method: 'POST' });
        console.log('reached', url);
    } catch (error) {
        console.log('refused', url, error.cause?.code);
    }
}`;

describe('default backend guard', () => {
    it('refuses loopback port 8000 like a closed port and reports each request', () => {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
            env: { ...process.env, ...defaultBackendGuardEnv('') },
            encoding: 'utf8',
            timeout: 30_000
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.stdout.trim().split('\n'), [
            'refused http://localhost:8000/stats ECONNREFUSED',
            'refused http://127.0.0.1:8000/v1/chat/completions ECONNREFUSED',
            'refused http://[::1]:8000/ ECONNREFUSED'
        ]);
        assert.deepEqual(result.stderr.match(/\[default-backend-guard\] blocked .*/g), [
            '[default-backend-guard] blocked POST /stats',
            '[default-backend-guard] blocked POST /v1/chat/completions',
            '[default-backend-guard] blocked POST /'
        ]);
    });
});
