/**
 * Perplexity Browser Login Service
 * Opens a dedicated browser window for login, automatically captures session token
 * Uses puppeteer-extra with stealth plugin to avoid bot detection
 */

import { loadBrowser } from './browser-loader.js';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { PerplexitySessionAccountManager } from './perplexity-session-account-manager.js';


const PERPLEXITY_URL = 'https://www.perplexity.ai';
const SESSION_COOKIE_NAME = '__Secure-next-auth.session-token';
const USER_DATA_DIR = join(homedir(), '.config', 'antigravity-proxy', 'perplexity-browser');

export class PerplexityBrowserLogin {
    constructor(accountManager) {
        this.accountManager = accountManager || new PerplexitySessionAccountManager();
        this.browser = null;
        this.isLoginInProgress = false;
    }

    /**
     * Launch browser for Perplexity login
     * Returns a promise that resolves when login is complete
     */
    async startLogin() {
        if (this.isLoginInProgress) {
            throw new Error('Login already in progress. Please complete the current login first.');
        }

        this.isLoginInProgress = true;
        console.log('[PerplexityLogin] Starting dedicated browser login...');

        try {
            // Launch browser with persistent profile and stealth mode
            this.browser = await (await loadBrowser()).launch({
                headless: false, // Show the browser window
                defaultViewport: null, // Use full window size
                userDataDir: USER_DATA_DIR, // Persist session data
                args: [
                    '--start-maximized',
                    '--disable-blink-features=AutomationControlled',
                    '--no-first-run',
                    '--no-default-browser-check',
                ]
            });

            const pages = await this.browser.pages();
            const page = pages[0] || await this.browser.newPage();

            // IMPORTANT: Clear existing Perplexity session to force fresh login
            console.log('[PerplexityLogin] Clearing any existing session to allow fresh login...');
            await page.deleteCookie({ name: SESSION_COOKIE_NAME, domain: '.perplexity.ai' });
            await page.deleteCookie({ name: SESSION_COOKIE_NAME, domain: 'www.perplexity.ai' });
            await page.deleteCookie({ name: SESSION_COOKIE_NAME, domain: 'perplexity.ai' });

            // Also clear NextAuth related cookies
            const allCookies = await page.cookies('https://www.perplexity.ai');
            for (const cookie of allCookies) {
                if (cookie.name.includes('next-auth') || cookie.name.includes('session')) {
                    await page.deleteCookie({ name: cookie.name, domain: cookie.domain });
                }
            }

            // Navigate to Perplexity homepage (login popup appears after clearing cookies)
            console.log('[PerplexityLogin] Opening Perplexity...');
            await page.goto(PERPLEXITY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for user to login
            console.log('[PerplexityLogin] Waiting for user to login...');
            console.log('[PerplexityLogin] TIP: You can use email/password or Google login');

            const result = await this.waitForLogin(page);

            if (result.success) {
                console.log(`[PerplexityLogin] ✅ Login successful for: ${result.email}`);
            } else {
                console.log('[PerplexityLogin] Login cancelled or failed:', result.error);
            }

            return result;

        } catch (error) {
            console.error('[PerplexityLogin] Error:', error.message);
            throw error;
        } finally {
            this.isLoginInProgress = false;
            if (this.browser) {
                try {
                    await this.browser.close();
                } catch (e) { /* ignore */ }
                this.browser = null;
            }
        }
    }

    /**
     * Capture session and save account
     */
    async captureSession(page, sessionToken) {
        let email = 'perplexity_user@local';

        try {
            // Wait for page to load fully
            await new Promise(r => setTimeout(r, 2000));

            // Method 1: Try to navigate to settings to get email
            try {
                await page.goto('https://www.perplexity.ai/settings/account', { waitUntil: 'networkidle2', timeout: 10000 });
                await new Promise(r => setTimeout(r, 1500));

                email = await page.evaluate(() => {
                    // Look for email in settings page
                    const allText = document.body.innerText;

                    // Try to find email pattern
                    const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    if (emailMatch) return emailMatch[0];

                    // Try to find username from page elements
                    const usernameEl = document.querySelector('[data-testid="username"]');
                    if (usernameEl?.textContent) return usernameEl.textContent.trim();

                    // Look for "Signed in as" text
                    const signedInMatch = allText.match(/[Ss]igned in as\s+([^\s\n]+)/);
                    if (signedInMatch) return signedInMatch[1];

                    return null;
                });

                console.log(`[PerplexityLogin] Detected email/username: ${email}`);
            } catch (e) {
                console.log('[PerplexityLogin] Could not navigate to settings, trying homepage');

                // Method 2: Try homepage for email
                email = await page.evaluate(() => {
                    const allText = document.body.innerText;
                    const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    return emailMatch ? emailMatch[0] : null;
                });
            }

            if (!email || !email.includes('@')) {
                // Generate a more readable fallback name
                const timestamp = new Date().toISOString().split('T')[0];
                email = `perplexity_${timestamp}@pro.local`;
            }
        } catch (e) {
            console.log('[PerplexityLogin] Could not detect email, using default:', e.message);
            const timestamp = new Date().toISOString().split('T')[0];
            email = `perplexity_${timestamp}@pro.local`;
        }

        // Save account to our session manager
        await this.accountManager.initialize();
        await this.accountManager.addAccount(email, sessionToken);

        // Also save to Python server's .env file for curl_cffi-based API calls
        try {
            const fs = await import('fs/promises');
            // Resolve relative to this file (src/ -> package -> repo root), not the current working directory
            const pythonEnvPath = fileURLToPath(new URL('../../perplexity-openai-api-ref/.env', import.meta.url));

            const envContent = `# Perplexity OpenAI-compatible API Server Configuration
# Auto-generated by Antigravity Proxy

PERPLEXITY_SESSION_TOKEN=${sessionToken}

# Server settings
HOST=127.0.0.1
PORT=8000
LOG_LEVEL=INFO

# Rate limiting
ENABLE_RATE_LIMITING=true
REQUESTS_PER_MINUTE=60

# Model defaults
DEFAULT_MODEL=perplexity-auto
DEFAULT_CITATION_MODE=CLEAN
`;
            await fs.writeFile(pythonEnvPath, envContent, { mode: 0o600 });
            console.log('[PerplexityLogin] Token saved to Python server .env file');
        } catch (e) {
            console.error('[PerplexityLogin] Could not save to Python .env:', e.message);
        }

        return {
            success: true,
            email: email,
            sessionToken: sessionToken
        };
    }

    /**
     * Poll for login completion by checking for session cookie
     */
    async waitForLogin(page, timeoutMs = 300000) { // 5 minute timeout
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                // Check if browser was closed
                if (!this.browser || !this.browser.isConnected()) {
                    return { success: false, error: 'Browser was closed' };
                }

                // Get cookies
                const cookies = await page.cookies();
                const sessionCookie = cookies.find(c => c.name === SESSION_COOKIE_NAME);

                if (sessionCookie && sessionCookie.value) {
                    console.log('[PerplexityLogin] Session cookie found!');
                    return await this.captureSession(page, sessionCookie.value);
                }

                // Wait before checking again
                await new Promise(r => setTimeout(r, 1000));

            } catch (error) {
                if (error.message.includes('Protocol error') || error.message.includes('Target closed')) {
                    return { success: false, error: 'Browser was closed' };
                }
                console.error('[PerplexityLogin] Check error:', error.message);
            }
        }

        return { success: false, error: 'Login timeout' };
    }

    /**
     * Check if login is in progress
     */
    isActive() {
        return this.isLoginInProgress;
    }
}

// Export singleton instance
let loginService = null;

export function getLoginService(accountManager) {
    if (!loginService) {
        loginService = new PerplexityBrowserLogin(accountManager);
    }
    return loginService;
}
