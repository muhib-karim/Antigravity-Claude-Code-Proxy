/**
 * Perplexity Session Account Manager
 * Manages Perplexity Pro accounts using session tokens
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = join(homedir(), '.config', 'antigravity-proxy', 'perplexity_sessions.json');

export class PerplexitySessionAccountManager {
    #accounts = [];
    #configPath;
    #currentIndex = 0;
    #initialized = false;

    constructor(configPath = CONFIG_PATH) {
        this.#configPath = configPath;
    }

    async initialize() {
        if (this.#initialized) return;

        try {
            const data = await readFile(this.#configPath, 'utf-8');
            const config = JSON.parse(data);
            this.#accounts = config.accounts || [];
            this.#currentIndex = config.activeIndex || 0;
            console.log(`[PerplexitySessionManager] Loaded ${this.#accounts.length} Perplexity session accounts.`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[PerplexitySessionManager] Failed to load config:', error.message);
            }
            this.#accounts = [];
        }

        this.#initialized = true;
    }

    async save() {
        try {
            const dir = dirname(this.#configPath);
            await mkdir(dir, { recursive: true });

            const config = {
                accounts: this.#accounts,
                activeIndex: this.#currentIndex,
                updatedAt: new Date().toISOString()
            };

            await writeFile(this.#configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
        } catch (error) {
            console.error('[PerplexitySessionManager] Failed to save config:', error);
        }
    }

    async addAccount(email, sessionToken) {
        if (!sessionToken || sessionToken.length < 50) {
            throw new Error('Invalid session token. Must be a long token from browser cookies.');
        }

        // Check for duplicates by email or token
        const existingByEmail = this.#accounts.findIndex(acc => acc.email === email);
        if (existingByEmail !== -1) {
            // Update existing account
            this.#accounts[existingByEmail].sessionToken = sessionToken;
            this.#accounts[existingByEmail].updatedAt = new Date().toISOString();
            this.#accounts[existingByEmail].isRateLimited = false;
            console.log('[PerplexitySessionManager] Updated existing account:', email);
        } else {
            // Add new account
            this.#accounts.push({
                email: email,
                sessionToken: sessionToken,
                addedAt: new Date().toISOString(),
                lastUsed: null,
                isRateLimited: false,
                rateLimitResetTime: null,
                usageCount: 0
            });
            console.log('[PerplexitySessionManager] Added new account:', email);
        }

        await this.save();
    }

    getAvailableAccount() {
        // Filter out rate-limited accounts
        const available = this.#accounts.filter(acc => {
            if (!acc.isRateLimited) return true;
            // Check if rate limit expired (5 minutes cooldown)
            if (acc.rateLimitResetTime && Date.now() > acc.rateLimitResetTime) {
                acc.isRateLimited = false;
                acc.rateLimitResetTime = null;
                return true;
            }
            return false;
        });

        if (available.length === 0) {
            return null;
        }

        // Round-robin selection
        const account = available[this.#currentIndex % available.length];
        this.#currentIndex = (this.#currentIndex + 1) % available.length;
        return account;
    }

    async markRateLimited(identifier) {
        const account = this.#accounts.find(a => a.email === identifier || a.sessionToken === identifier);
        if (account) {
            account.isRateLimited = true;
            account.rateLimitResetTime = Date.now() + 5 * 60 * 1000; // 5 minute cooldown
            console.log(`[PerplexitySessionManager] Marked account ${account.email} as rate limited.`);
            await this.save();
        }
    }

    async updateUsage(identifier) {
        const account = this.#accounts.find(a => a.email === identifier || a.sessionToken === identifier);
        if (account) {
            account.lastUsed = new Date().toISOString();
            account.usageCount = (account.usageCount || 0) + 1;
            // Save periodically, not on every request
            if (account.usageCount % 10 === 0) {
                await this.save();
            }
        }
    }

    async removeAccount(email) {
        const index = this.#accounts.findIndex(a => a.email === email);
        if (index !== -1) {
            this.#accounts.splice(index, 1);
            await this.save();
            console.log('[PerplexitySessionManager] Removed account:', email);
            return true;
        }
        return false;
    }

    async renameAccount(email, newName) {
        const account = this.#accounts.find(a => a.email === email);
        if (account) {
            const oldEmail = account.email;
            account.email = newName;
            await this.save();
            console.log(`[PerplexitySessionManager] Renamed account from ${oldEmail} to ${newName}`);
            return true;
        }
        return false;
    }

    getAccounts() {
        return this.#accounts.map(acc => ({
            email: acc.email,
            lastUsed: acc.lastUsed,
            usageCount: acc.usageCount,
            isRateLimited: acc.isRateLimited,
            // Don't expose full session token
            hasToken: !!acc.sessionToken,
        }));
    }

    hasAccounts() {
        return this.#accounts.length > 0;
    }
}
