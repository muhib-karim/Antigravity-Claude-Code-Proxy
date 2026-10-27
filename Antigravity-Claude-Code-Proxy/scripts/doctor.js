#!/usr/bin/env node

/**
 * Doctor Script - Setup Verification
 *
 * Checks system requirements, configuration, and connectivity
 * to help diagnose setup issues with Antigravity Claude Proxy.
 *
 * Usage: npm run doctor
 */

import { homedir, platform, arch } from 'os';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: '\x1b[1m',
    dim: '\x1b[2m'
};

const PASS = `${colors.green}✓${colors.reset}`;
const FAIL = `${colors.red}✗${colors.reset}`;
const WARN = `${colors.yellow}⚠${colors.reset}`;
const INFO = `${colors.blue}ℹ${colors.reset}`;

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(message) {
    console.log(`  ${PASS} ${message}`);
    passCount++;
}

function fail(message, hint = '') {
    console.log(`  ${FAIL} ${message}`);
    if (hint) console.log(`    ${colors.dim}${hint}${colors.reset}`);
    failCount++;
}

function warn(message, hint = '') {
    console.log(`  ${WARN} ${message}`);
    if (hint) console.log(`    ${colors.dim}${hint}${colors.reset}`);
    warnCount++;
}

function info(message) {
    console.log(`  ${INFO} ${message}`);
}

function section(title) {
    console.log(`\n${colors.bold}${title}${colors.reset}`);
    console.log('─'.repeat(50));
}

// Check Node.js version
function checkNodeVersion() {
    section('Node.js');
    const version = process.version;
    const [major, minor] = version.slice(1).split('.').map(n => parseInt(n, 10));

    // Matches engines.node in package.json (better-sqlite3 and ESLint need 22.13+)
    if (major > 22 || (major === 22 && minor >= 13)) {
        pass(`Node.js ${version} (>=22.13 required)`);
    } else {
        fail(`Node.js ${version} - version 22.13 or higher required`, 'Upgrade Node.js: https://nodejs.org/');
    }
}

// Check package.json and dependencies
function checkDependencies() {
    section('Dependencies');

    const packagePath = join(__dirname, '..', 'package.json');
    if (!existsSync(packagePath)) {
        fail('package.json not found');
        return;
    }

    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    pass(`Package: ${pkg.name}@${pkg.version}`);

    const nodeModulesPath = join(__dirname, '..', 'node_modules');
    if (!existsSync(nodeModulesPath)) {
        fail('node_modules not found', 'Run: npm install');
        return;
    }

    // Check critical dependencies
    const criticalDeps = ['express', 'better-sqlite3', 'dotenv', 'cors'];
    for (const dep of criticalDeps) {
        const depPath = join(nodeModulesPath, dep);
        if (existsSync(depPath)) {
            pass(`${dep} installed`);
        } else {
            fail(`${dep} not installed`, 'Run: npm install');
        }
    }
}

// Check environment configuration
function checkEnvironment() {
    section('Environment');

    // Check for .env file
    const envPath = join(__dirname, '..', '.env');
    if (existsSync(envPath)) {
        pass('.env file exists');
    } else {
        info('.env file not found (using defaults)');
    }

    // Check critical environment variables
    const envVars = {
        PORT: { default: '8080', required: false },
        LOG_LEVEL: { default: 'info', required: false },
        AUTO_WAIT_FOR_RATE_LIMIT: { default: 'true', required: false }
    };

    for (const [name, config] of Object.entries(envVars)) {
        const value = process.env[name];
        if (value) {
            pass(`${name}=${value}`);
        } else {
            info(`${name} not set (default: ${config.default})`);
        }
    }

    // Check OAuth credentials
    if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
        pass('Custom OAuth credentials configured');
    } else {
        info('Using default OAuth credentials');
    }
}

// Check account configuration
function checkAccounts() {
    section('Accounts');

    const configPaths = [
        join(homedir(), '.config', 'antigravity-proxy', 'accounts.json'),
        process.env.ACCOUNT_CONFIG_PATH
    ].filter(Boolean);

    let accountsFound = false;
    let accounts = [];

    for (const configPath of configPaths) {
        if (existsSync(configPath)) {
            try {
                const data = JSON.parse(readFileSync(configPath, 'utf-8'));
                accounts = data.accounts || [];
                if (accounts.length > 0) {
                    accountsFound = true;
                    pass(`Found ${accounts.length} account(s) in ${configPath}`);
                    for (const acc of accounts) {
                        info(`  - ${acc.email || 'Unknown email'}`);
                    }
                    break;
                }
            } catch (e) {
                warn(`Failed to parse ${configPath}: ${e.message}`);
            }
        }
    }

    if (!accountsFound) {
        warn('No accounts configured', 'Run: npm run accounts:add');
    }

    // Check for Antigravity app database (legacy mode)
    const dbPaths = {
        darwin: join(homedir(), 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb'),
        win32: join(homedir(), 'AppData/Roaming/Antigravity/User/globalStorage/state.vscdb'),
        linux: join(homedir(), '.config/Antigravity/User/globalStorage/state.vscdb')
    };

    const currentPlatform = platform();
    const dbPath = dbPaths[currentPlatform] || dbPaths.linux;

    if (existsSync(dbPath)) {
        pass('Antigravity app database found (legacy single-account)');
    } else {
        info('Antigravity app database not found (OK if using multi-account)');
    }
}

// Check platform info
function checkPlatform() {
    section('Platform');
    pass(`Platform: ${platform()}`);
    pass(`Architecture: ${arch()}`);
    pass(`Home directory: ${homedir()}`);
}

// Check port availability
async function checkPort() {
    section('Network');

    const port = parseInt(process.env.PORT || '8080', 10);
    info(`Configured port: ${port}`);

    try {
        const response = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
            const data = await response.json();
            pass(`Proxy server is running (status: ${data.status})`);
            if (data.accounts) {
                // accounts is a summary string like "2 total, 2 available"
                info(`  - ${data.accounts}`);
            }
            if (data.rateLimited > 0) {
                warn(`  - ${data.rateLimited} account(s) rate-limited`);
            }
        } else {
            warn(`Server responded with ${response.status}`);
        }
    } catch (e) {
        if (e.name === 'TypeError' || e.code === 'ECONNREFUSED') {
            info('Proxy server not running (OK for initial setup)');
        } else {
            info(`Could not connect to server: ${e.message}`);
        }
    }
}

// Check connectivity to Antigravity endpoints
async function checkConnectivity() {
    section('Connectivity');

    const endpoints = [
        'https://daily-cloudcode-pa.sandbox.googleapis.com',
        'https://cloudcode-pa.googleapis.com'
    ];

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'HEAD',
                signal: AbortSignal.timeout(5000)
            });
            // 404 is expected - we just want to know the server is reachable
            if (response.status === 404 || response.status === 405 || response.ok) {
                pass(`${endpoint} - reachable`);
            } else {
                warn(`${endpoint} - status ${response.status}`);
            }
        } catch (e) {
            fail(`${endpoint} - ${e.message}`, 'Check internet connection or firewall settings');
        }
    }
}

// Print summary
function printSummary() {
    console.log('\n' + '═'.repeat(50));
    console.log(`${colors.bold}Summary${colors.reset}`);
    console.log('─'.repeat(50));
    console.log(`  ${colors.green}Passed:${colors.reset}   ${passCount}`);
    console.log(`  ${colors.red}Failed:${colors.reset}   ${failCount}`);
    console.log(`  ${colors.yellow}Warnings:${colors.reset} ${warnCount}`);
    console.log('═'.repeat(50));

    if (failCount > 0) {
        console.log(`\n${colors.red}${colors.bold}Some checks failed. Please address the issues above.${colors.reset}\n`);
        process.exit(1);
    } else if (warnCount > 0) {
        console.log(`\n${colors.yellow}Setup looks OK with some warnings. Review the warnings above.${colors.reset}\n`);
    } else {
        console.log(`\n${colors.green}${colors.bold}All checks passed! Your setup looks good.${colors.reset}\n`);
    }
}

// Main
async function main() {
    console.log('\n' + '═'.repeat(50));
    console.log(`${colors.bold}  Antigravity Claude Proxy - Doctor${colors.reset}`);
    console.log('═'.repeat(50));

    checkNodeVersion();
    checkDependencies();
    checkEnvironment();
    checkAccounts();
    checkPlatform();
    await checkPort();
    await checkConnectivity();

    printSummary();
}

main().catch(err => {
    console.error(`\n${FAIL} Doctor script error:`, err.message);
    process.exit(1);
});
