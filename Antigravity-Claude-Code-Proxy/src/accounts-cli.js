#!/usr/bin/env node

/**
 * Account Management CLI
 *
 * Interactive CLI for adding and managing Google accounts
 * for the Antigravity Claude Proxy.
 *
 * Usage:
 *   node src/accounts-cli.js          # Interactive mode
 *   node src/accounts-cli.js add      # Add new account(s)
 *   node src/accounts-cli.js list     # List all accounts
 *   node src/accounts-cli.js clear    # Remove all accounts
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { exec } from 'child_process';
import net from 'net';
import { ACCOUNT_CONFIG_PATH, DEFAULT_PORT, MAX_ACCOUNTS } from './constants.js';
import {
    getAuthorizationUrl,
    startCallbackServer,
    closeCallbackServer,
    completeOAuthFlow,
    refreshAccessToken,
    getUserEmail
} from './oauth.js';

const SERVER_PORT = process.env.PORT || DEFAULT_PORT;

/**
 * Check if the Antigravity Proxy server is running
 * Returns true if port is occupied
 */
function isServerRunning() {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true); // Server is running
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('error', (err) => {
            socket.destroy();
            resolve(false); // Port free
        });

        socket.connect(SERVER_PORT, 'localhost');
    });
}

/**
 * Enforce that server is stopped before proceeding
 */
async function ensureServerStopped() {
    const isRunning = await isServerRunning();
    if (isRunning) {
        console.error(`
\x1b[31mError: Antigravity Proxy server is currently running on port ${SERVER_PORT}.\x1b[0m

Please stop the server (Ctrl+C) before adding or managing accounts.
This ensures that your account changes are loaded correctly when you restart the server.
`);
        process.exit(1);
    }
}

/**
 * Create readline interface
 */
function createRL() {
    return createInterface({ input: stdin, output: stdout });
}

/**
 * Open URL in default browser
 */
function openBrowser(url) {
    const platform = process.platform;
    let command;

    if (platform === 'darwin') {
        command = `open "${url}"`;
    } else if (platform === 'win32') {
        command = `start "" "${url}"`;
    } else {
        command = `xdg-open "${url}"`;
    }

    exec(command, (error) => {
        if (error) {
            console.log('\n⚠ Could not open browser automatically.');
            console.log('Please open this URL manually:', url);
        }
    });
}

/**
 * Load existing accounts from config
 */
function loadAccounts() {
    try {
        if (existsSync(ACCOUNT_CONFIG_PATH)) {
            const data = readFileSync(ACCOUNT_CONFIG_PATH, 'utf-8');
            const config = JSON.parse(data);
            return config.accounts || [];
        }
    } catch (error) {
        console.error('Error loading accounts:', error.message);
    }
    return [];
}

/**
 * Save accounts to config
 */
function saveAccounts(accounts, settings = {}) {
    try {
        const dir = dirname(ACCOUNT_CONFIG_PATH);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        const config = {
            accounts: accounts.map(acc => ({
                email: acc.email,
                source: 'oauth',
                refreshToken: acc.refreshToken,
                projectId: acc.projectId,
                addedAt: acc.addedAt || new Date().toISOString(),
                lastUsed: acc.lastUsed || null,
                isRateLimited: acc.isRateLimited || false,
                rateLimitResetTime: acc.rateLimitResetTime || null
            })),
            settings: {
                cooldownDurationMs: 60000,
                maxRetries: 5,
                ...settings
            },
            activeIndex: 0
        };

        writeFileSync(ACCOUNT_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
        console.log(`\n✓ Saved ${accounts.length} account(s) to ${ACCOUNT_CONFIG_PATH}`);
    } catch (error) {
        console.error('Error saving accounts:', error.message);
        throw error;
    }
}

/**
 * Display current accounts
 */
function displayAccounts(accounts) {
    if (accounts.length === 0) {
        console.log('\nNo accounts configured.');
        return;
    }

    console.log(`\n${accounts.length} account(s) saved:`);
    accounts.forEach((acc, i) => {
        const status = acc.isRateLimited ? ' (rate-limited)' : '';
        console.log(`  ${i + 1}. ${acc.email}${status}`);
    });
}

/**
 * Add a new account via OAuth with automatic callback
 */
async function addAccount(existingAccounts) {
    console.log('\n=== Add Google Account ===\n');

    // Generate authorization URL
    const { url, verifier, state } = getAuthorizationUrl();

    console.log('Opening browser for Google sign-in...');
    console.log('(If browser does not open, copy this URL manually)\n');
    console.log(`   ${url}\n`);

    // Open browser
    openBrowser(url);

    // Start callback server and wait for code
    console.log('Waiting for authentication (timeout: 2 minutes)...\n');

    try {
        const code = await startCallbackServer(state);

        console.log('Received authorization code. Exchanging for tokens...');
        const result = await completeOAuthFlow(code, verifier);

        // Check if account already exists
        const existing = existingAccounts.find(a => a.email === result.email);
        if (existing) {
            console.log(`\n⚠ Account ${result.email} already exists. Updating tokens.`);
            existing.refreshToken = result.refreshToken;
            existing.projectId = result.projectId;
            existing.addedAt = new Date().toISOString();
            return null; // Don't add duplicate
        }

        console.log(`\n✓ Successfully authenticated: ${result.email}`);
        if (result.projectId) {
            console.log(`  Project ID: ${result.projectId}`);
        }

        return {
            email: result.email,
            refreshToken: result.refreshToken,
            projectId: result.projectId,
            addedAt: new Date().toISOString(),
            isRateLimited: false,
            rateLimitResetTime: null
        };
    } catch (error) {
        console.error(`\n✗ Authentication failed: ${error.message}`);
        return null;
    }
}

/**
 * Interactive remove accounts flow
 */
async function interactiveRemove(rl) {
    while (true) {
        const accounts = loadAccounts();
        if (accounts.length === 0) {
            console.log('\nNo accounts to remove.');
            return;
        }

        displayAccounts(accounts);
        console.log('\nEnter account number to remove (or 0 to cancel)');

        const answer = await rl.question('> ');
        const index = parseInt(answer, 10);

        if (isNaN(index) || index < 0 || index > accounts.length) {
            console.log('\n❌ Invalid selection.');
            continue;
        }

        if (index === 0) {
            return; // Exit
        }

        const removed = accounts[index - 1]; // 1-based to 0-based
        const confirm = await rl.question(`\nAre you sure you want to remove ${removed.email}? [y/N]: `);

        if (confirm.toLowerCase() === 'y') {
            accounts.splice(index - 1, 1);
            saveAccounts(accounts);
            console.log(`\n✓ Removed ${removed.email}`);
        } else {
            console.log('\nCancelled.');
        }

        const removeMore = await rl.question('\nRemove another account? [y/N]: ');
        if (removeMore.toLowerCase() !== 'y') {
            break;
        }
    }
}

/**
 * Interactive add accounts flow (Main Menu)
 */
async function interactiveAdd(rl) {
    const accounts = loadAccounts();

    if (accounts.length > 0) {
        displayAccounts(accounts);

        const choice = await rl.question('\n(a)dd new, (r)emove existing, or (f)resh start? [a/r/f]: ');
        const c = choice.toLowerCase();

        if (c === 'r') {
            await interactiveRemove(rl);
            return; // Return to main or exit? Given this is "add", we probably exit after sub-task.
        } else if (c === 'f') {
            console.log('\nStarting fresh - existing accounts will be replaced.');
            accounts.length = 0;
        } else if (c === 'a') {
            console.log('\nAdding to existing accounts.');
        } else {
            console.log('\nInvalid choice, defaulting to add.');
        }
    }

    // Add accounts loop
    while (accounts.length < MAX_ACCOUNTS) {
        const newAccount = await addAccount(accounts);
        if (newAccount) {
            accounts.push(newAccount);
            // Auto-save after each successful add to prevent data loss
            saveAccounts(accounts);
        } else if (accounts.length > 0) {
            // Even if newAccount is null (duplicate update), save the updated accounts
            saveAccounts(accounts);
        }

        if (accounts.length >= MAX_ACCOUNTS) {
            console.log(`\nMaximum of ${MAX_ACCOUNTS} accounts reached.`);
            break;
        }

        const addMore = await rl.question('\nAdd another account? [y/N]: ');
        if (addMore.toLowerCase() !== 'y') {
            break;
        }
    }

    if (accounts.length > 0) {
        displayAccounts(accounts);
    } else {
        console.log('\nNo accounts to save.');
    }
}

/**
 * List accounts
 */
async function listAccounts() {
    const accounts = loadAccounts();
    displayAccounts(accounts);

    if (accounts.length > 0) {
        console.log(`\nConfig file: ${ACCOUNT_CONFIG_PATH}`);
    }
}

/**
 * Clear all accounts
 */
async function clearAccounts(rl) {
    const accounts = loadAccounts();

    if (accounts.length === 0) {
        console.log('No accounts to clear.');
        return;
    }

    displayAccounts(accounts);

    const confirm = await rl.question('\nAre you sure you want to remove all accounts? [y/N]: ');
    if (confirm.toLowerCase() === 'y') {
        saveAccounts([]);
        console.log('All accounts removed.');
    } else {
        console.log('Cancelled.');
    }
}

/**
 * Verify accounts (test refresh tokens)
 */
async function verifyAccounts() {
    const accounts = loadAccounts();

    if (accounts.length === 0) {
        console.log('No accounts to verify.');
        return;
    }

    console.log('\nVerifying accounts...\n');

    for (const account of accounts) {
        try {
            const tokens = await refreshAccessToken(account.refreshToken);
            const email = await getUserEmail(tokens.accessToken);
            console.log(`  ✓ ${email} - OK`);
        } catch (error) {
            console.log(`  ✗ ${account.email} - ${error.message}`);
        }
    }
}

/**
 * Main CLI
 */
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'add';

    console.log('╔════════════════════════════════════════╗');
    console.log('║   Antigravity Proxy Account Manager    ║');
    console.log('╚════════════════════════════════════════╝');

    const rl = createRL();

    try {
        switch (command) {
            case 'add':
                await ensureServerStopped();
                await interactiveAdd(rl);
                break;
            case 'list':
                await listAccounts();
                break;
            case 'clear':
                await ensureServerStopped();
                await clearAccounts(rl);
                break;
            case 'verify':
                await verifyAccounts();
                break;
            case 'help':
                console.log('\nUsage:');
                console.log('  node src/accounts-cli.js add     Add new account(s)');
                console.log('  node src/accounts-cli.js list    List all accounts');
                console.log('  node src/accounts-cli.js verify  Verify account tokens');
                console.log('  node src/accounts-cli.js clear   Remove all accounts');
                console.log('  node src/accounts-cli.js help    Show this help');
                break;
            case 'remove':
                await ensureServerStopped();
                await interactiveRemove(rl);
                break;
            default:
                console.log(`Unknown command: ${command}`);
                console.log('Run with "help" for usage information.');
        }
    } finally {
        rl.close();
        // The OAuth callback server keeps the event loop alive; release it so the CLI exits
        closeCallbackServer();
    }
}

main().catch(console.error);
