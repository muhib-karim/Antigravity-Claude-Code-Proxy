/**
 * Smoke tests for the bin/cli.js entry point (flags that do not start the server).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });

test('--help prints usage and exits 0', () => {
    for (const flag of ['--help', '-h']) {
        const res = run(flag);
        assert.equal(res.status, 0, res.stderr);
        assert.match(res.stdout, new RegExp(`antigravity-claude-proxy v${version.replace(/\./g, '\\.')}`));
        assert.match(res.stdout, /USAGE:/);
        assert.match(res.stdout, /accounts add/);
    }
});

test('--version prints the package version', () => {
    const res = run('--version');
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), version);
});

test('unknown commands fail with exit code 1 and a usage hint', () => {
    const res = run('definitely-not-a-command');
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Unknown command: definitely-not-a-command/);
    assert.match(res.stderr, /antigravity-claude-proxy --help/);
});
