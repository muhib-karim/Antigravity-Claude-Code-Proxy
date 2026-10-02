import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { PERPLEXITY_CONFIG_PATH } from './constants.js';

export class PerplexityAccountManager {
    #accounts = [];
    #configPath;
    #currentIndex = 0;
    #initialized = false;

    constructor(configPath = PERPLEXITY_CONFIG_PATH) {
        this.#configPath = configPath;
    }

    async initialize() {
        if (this.#initialized) return;

        try {
            const data = await readFile(this.#configPath, 'utf-8');
            const config = JSON.parse(data);
            this.#accounts = config.accounts || [];
            this.#currentIndex = config.activeIndex || 0;
            console.log(`[PerplexityAccountManager] Loaded ${this.#accounts.length} accounts.`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[PerplexityAccountManager] Failed to load config:', error);
            }
            // If file doesn't exist, start with empty list
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
            console.error('[PerplexityAccountManager] Failed to save config:', error);
        }
    }

    async addAccount(apiKey) {
        if (!apiKey || !apiKey.startsWith('pplx-')) {
            throw new Error('Invalid API Key format. Must start with pplx-');
        }

        // Check for duplicates
        if (this.#accounts.some(acc => acc.apiKey === apiKey)) {
            console.log('[PerplexityAccountManager] Account already exists.');
            return;
        }

        this.#accounts.push({
            apiKey,
            addedAt: new Date().toISOString(),
            lastUsed: null,
            isRateLimited: false,
            rateLimitResetTime: null,
            usageCount: 0
        });

        await this.save();
        console.log('[PerplexityAccountManager] Account added successfully.');
    }

    getAvailableAccount() {
        // Filter out rate-limited accounts
        const available = this.#accounts.filter(acc => {
            if (!acc.isRateLimited) return true;
            // Check if rate limit expired
            if (acc.rateLimitResetTime && Date.now() > acc.rateLimitResetTime) {
                acc.isRateLimited = false;
                acc.rateLimitResetTime = null;
                return true;
            }
            return false;
        });

        if (available.length === 0) {
            return null; // All exhausted
        }

        // Simple round-robin or pick next
        // For simplicity, we can just rotate through the list based on currentIndex
        // But since we filtered, we should pick from 'available'
        // Let's just pick the one that was least recently used, or just cycle.

        // Find the first available account starting from currentIndex
        // But since 'available' is a subset, let's just pick the first one from available that matches our rotation strategy.
        // Or simpler: Just return the first available one and rotate usage.

        const account = available[0]; // Simple failover
        return account;
    }

    async markRateLimited(apiKey) {
        const account = this.#accounts.find(a => a.apiKey === apiKey);
        if (account) {
            account.isRateLimited = true;
            // Default 1 minute cooldown, can be smarter
            account.rateLimitResetTime = Date.now() + 60 * 1000;
            console.log(`[PerplexityAccountManager] Marked account ending in ...${apiKey.slice(-5)} as rate limited.`);
            await this.save();
        }
    }

    async updateUsage(apiKey) {
        const account = this.#accounts.find(a => a.apiKey === apiKey);
        if (account) {
            account.lastUsed = new Date().toISOString();
            account.usageCount = (account.usageCount || 0) + 1;
            // Don't save on every request regarding perf, maybe debounce?
            // For now, save periodically or rely on in-memory for short term.
            // But to persist across restarts, we should save.
            await this.save();
        }
    }

    getAccounts() {
        return this.#accounts;
    }
}
