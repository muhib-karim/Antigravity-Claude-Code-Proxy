/**
 * AccountManager persistence tests (no network, temp files only).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../../src/account-manager.js';

function tempConfigPath() {
    const dir = mkdtempSync(join(tmpdir(), 'acm-test-'));
    return { dir, path: join(dir, 'accounts.json') };
}

describe('AccountManager persistence', () => {
    it('does not overwrite an accounts file it could not parse', async () => {
        const { dir, path } = tempConfigPath();
        const broken = '{ "accounts": [ { "email": "a" }, ';
        writeFileSync(path, broken);
        try {
            const manager = new AccountManager(path);
            await manager.initialize();
            await manager.saveToDisk();
            assert.equal(readFileSync(path, 'utf-8'), broken);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('loads manual accounts and writes the config owner-only', async () => {
        const { dir, path } = tempConfigPath();
        try {
            const manager = new AccountManager(path);
            await manager.initialize();
            await manager.saveToDisk();
            if (process.platform !== 'win32') {
                assert.equal(statSync(path).mode & 0o777, 0o600);
            }

            writeFileSync(path, JSON.stringify({
                accounts: [{ email: 'mock-account', source: 'manual', apiKey: 'k', projectId: 'p' }]
            }));
            const reloaded = new AccountManager(path);
            await reloaded.initialize();
            assert.equal(reloaded.getAccountCount(), 1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
