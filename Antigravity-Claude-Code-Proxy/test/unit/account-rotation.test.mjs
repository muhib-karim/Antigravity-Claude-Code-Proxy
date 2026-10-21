/**
 * Unit tests for per-account cooldown and rotation in AccountManager:
 * sticky selection (prompt-cache continuity), short waits vs. switching,
 * skipping rate-limited/invalid accounts, cooldown expiry and minimum wait.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../../src/account-manager.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const LONG = 10 * 60 * 1000; // longer than MAX_WAIT_BEFORE_ERROR (2 min): forces a switch
const SHORT = 30 * 1000; // within MAX_WAIT_BEFORE_ERROR: wait for the sticky account

let dir;

/**
 * @param {object} [settings]
 * @returns {Promise<AccountManager>}
 */
async function managerWith(settings = {}) {
    const path = join(dir, 'accounts.json');
    const accounts = ['a', 'b', 'c'].map(n => ({
        email: `${n}@example.test`,
        source: 'manual',
        apiKey: `k-${n}`,
        projectId: 'p'
    }));
    writeFileSync(path, JSON.stringify({ accounts, settings, activeIndex: 0 }));
    const manager = new AccountManager(path);
    await manager.initialize();
    return manager;
}

const email = account => account?.email ?? null;

describe('AccountManager cooldown and rotation', () => {
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'acm-rotation-'));
    });
    afterEach(async () => {
        await sleep(20); // let background saveToDisk() calls settle
        rmSync(dir, { recursive: true, force: true });
    });

    it('sticks to the current account across requests', async () => {
        const m = await managerWith();
        assert.equal(email(m.pickStickyAccount().account), 'a@example.test');
        assert.equal(email(m.pickStickyAccount().account), 'a@example.test');
    });

    it('waits for the sticky account when its cooldown is short', async () => {
        const m = await managerWith();
        m.markRateLimited('a@example.test', SHORT);
        const { account, waitMs } = m.pickStickyAccount();
        assert.equal(account, null);
        assert.ok(waitMs > SHORT - 1000 && waitMs <= SHORT, `waitMs ${waitMs}`);
    });

    it('switches to the next account when the cooldown is long, then sticks to it', async () => {
        const m = await managerWith();
        m.markRateLimited('a@example.test', LONG);
        assert.equal(email(m.pickStickyAccount().account), 'b@example.test');
        assert.equal(email(m.pickStickyAccount().account), 'b@example.test');
    });

    it('rotation skips rate-limited and invalid accounts and wraps around', async () => {
        const m = await managerWith();
        m.markRateLimited('b@example.test', LONG);
        m.markInvalid('c@example.test', 'revoked');
        assert.equal(email(m.pickNext()), 'a@example.test', 'from a, b and c are skipped and it wraps to a');
        m.markRateLimited('a@example.test', LONG);
        assert.equal(m.pickNext(), null);
    });

    it('reports all-rate-limited with the shortest remaining wait', async () => {
        const m = await managerWith();
        assert.equal(m.getMinWaitTimeMs(), 0, 'no wait while an account is available');
        m.markRateLimited('a@example.test', LONG);
        m.markRateLimited('b@example.test', 5 * 60 * 1000);
        m.markRateLimited('c@example.test', LONG);
        assert.equal(m.isAllRateLimited(), true);
        const wait = m.getMinWaitTimeMs();
        assert.ok(wait > 4 * 60 * 1000 && wait <= 5 * 60 * 1000, `wait ${wait}`);
    });

    it('cooldowns expire and the account becomes available again', async () => {
        const m = await managerWith();
        m.markRateLimited('a@example.test', 30);
        assert.equal(m.getAvailableAccounts().length, 2);
        await sleep(60);
        assert.equal(m.clearExpiredLimits(), 1);
        assert.equal(m.getAvailableAccounts().length, 3);
        assert.equal(email(m.pickStickyAccount().account), 'a@example.test');
    });

    it('uses the configured cooldown when the upstream gives no reset time', async () => {
        const m = await managerWith({ cooldownDurationMs: 5000 });
        const before = Date.now();
        m.markRateLimited('a@example.test');
        const reset = m.getStatus().accounts.find(a => a.email === 'a@example.test').rateLimitResetTime;
        assert.ok(reset >= before + 5000 && reset <= Date.now() + 5000, `reset ${reset - before}ms`);
    });

    it('resetAllRateLimits clears every cooldown (optimistic retry)', async () => {
        const m = await managerWith();
        for (const n of ['a', 'b', 'c']) m.markRateLimited(`${n}@example.test`, LONG);
        m.resetAllRateLimits();
        assert.equal(m.isAllRateLimited(), false);
        assert.equal(m.getStatus().rateLimited, 0);
    });

    it('ignores unknown accounts', async () => {
        const m = await managerWith();
        m.markRateLimited('nobody@example.test', LONG);
        m.markInvalid('nobody@example.test');
        assert.equal(m.getStatus().available, 3);
    });
});
