/**
 * Perplexity Browser API Client
 * Uses Puppeteer to make API requests from within a real browser context
 * This bypasses TLS fingerprinting that blocks Node.js fetch
 */

import { loadBrowser } from './browser-loader.js';
import { join } from 'path';
import { homedir } from 'os';


const PERPLEXITY_URL = 'https://www.perplexity.ai';
const API_URL = 'https://www.perplexity.ai/rest/sse/perplexity_ask';
const USER_DATA_DIR = join(homedir(), '.config', 'antigravity-proxy', 'perplexity-browser');
const API_VERSION = '2.18';

// Model mappings for Perplexity
const PERPLEXITY_MODELS = {
    'perplexity-auto': { identifier: 'default', mode: 'copilot' },
    'perplexity-sonar': { identifier: 'experimental', mode: 'copilot' },
    'perplexity-research': { identifier: 'pplx_alpha', mode: 'copilot' },
    'perplexity-labs': { identifier: 'pplx_beta', mode: 'copilot' },
    'sonar': { identifier: 'experimental', mode: 'copilot' },
    'sonar-pro': { identifier: 'default', mode: 'copilot' },
    'pplx-gpt51': { identifier: 'gpt51thinking', mode: 'copilot' },
    'pplx-gpt52': { identifier: 'gpt52', mode: 'copilot' },
    'pplx-claude-sonnet': { identifier: 'claude45sonnet', mode: 'copilot' },
    'pplx-claude-opus': { identifier: 'claudeopus45', mode: 'copilot' },
    'pplx-gemini-pro': { identifier: 'gemini30pro', mode: 'copilot' },
    'pplx-gemini-flash': { identifier: 'gemini30flash', mode: 'copilot' },
    'pplx-grok': { identifier: 'grok41nonreasoning', mode: 'copilot' },
    'pplx-kimi': { identifier: 'kimik2thinking', mode: 'copilot' },
};

class PerplexityBrowserClient {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isInitialized = false;
        this.initPromise = null;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async _doInitialize() {
        console.log('[PerplexityBrowser] Launching headless browser...');

        this.browser = await (await loadBrowser()).launch({
            headless: 'new', // Use new headless mode
            userDataDir: USER_DATA_DIR, // Reuse persistent session
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-gpu',
                '--disable-dev-shm-usage',
            ]
        });

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();

        // Navigate to Perplexity to ensure cookies are loaded
        console.log('[PerplexityBrowser] Loading Perplexity to verify session...');
        await this.page.goto(PERPLEXITY_URL, { waitUntil: 'networkidle2', timeout: 30000 });

        // Check if logged in
        const cookies = await this.page.cookies();
        const hasSession = cookies.some(c => c.name === '__Secure-next-auth.session-token' && c.value);

        if (!hasSession) {
            console.log('[PerplexityBrowser] No active session found. Please login via dashboard.');
            throw new Error('Perplexity session not found. Please login via dashboard first.');
        }

        console.log('[PerplexityBrowser] Session verified. Browser ready for API requests.');
        this.isInitialized = true;
    }

    async sendMessage(messages, model, system) {
        await this.initialize();

        const query = system
            ? `[System]\n${system}\n\n${this.messagesToQuery(messages)}`
            : this.messagesToQuery(messages);

        const modelConfig = PERPLEXITY_MODELS[model.toLowerCase()] || PERPLEXITY_MODELS['perplexity-auto'];

        const payload = {
            params: {
                attachments: [],
                language: 'en-US',
                timezone: 'UTC',
                client_coordinates: null,
                sources: ['web'],
                model_preference: modelConfig.identifier,
                mode: modelConfig.mode,
                search_focus: 'internet',
                search_recency_filter: null,
                is_incognito: true,
                use_schematized_api: false,
                local_search_enabled: false,
                prompt_source: 'user',
                send_back_text_in_streaming_api: true,
                version: API_VERSION,
            },
            query_str: query,
        };

        console.log(`[PerplexityBrowser] Making API request for model: ${model}`);

        // Make the request from within the browser context
        const result = await this.page.evaluate(async (url, body) => {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Accept': 'text/event-stream, application/json',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                    credentials: 'include', // Include cookies
                });

                if (!response.ok) {
                    return { error: true, status: response.status, message: `HTTP ${response.status}` };
                }

                const text = await response.text();
                return { error: false, text };
            } catch (err) {
                return { error: true, status: 0, message: err.message };
            }
        }, API_URL, payload);

        if (result.error) {
            console.error(`[PerplexityBrowser] API Error: ${result.status} - ${result.message}`);
            throw new Error(`Perplexity API Error: ${result.status} ${result.message}`);
        }

        // Parse SSE response
        const answer = this.parseSSEResponse(result.text);
        return this.toAnthropicFormat(answer, modelConfig.identifier);
    }

    messagesToQuery(messages) {
        const userMsgs = messages.filter(m => m.role === 'user');
        const systemMsgs = messages.filter(m => m.role === 'system');

        if (userMsgs.length === 1 && systemMsgs.length === 0) {
            return this.extractTextContent(userMsgs[0].content);
        }

        const parts = [];
        for (const msg of messages) {
            const content = this.extractTextContent(msg.content);
            if (msg.role === 'system') {
                parts.push(`[System]\n${content}`);
            } else if (msg.role === 'user') {
                parts.push(`User: ${content}`);
            } else if (msg.role === 'assistant') {
                parts.push(`Assistant: ${content}`);
            }
        }
        return parts.join('\n\n');
    }

    extractTextContent(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
        }
        return String(content);
    }

    parseSSEResponse(sseText) {
        const lines = sseText.split('\n');
        let finalAnswer = '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.substring(6));
                    if (data.text) {
                        const textData = typeof data.text === 'string'
                            ? JSON.parse(data.text)
                            : data.text;
                        if (textData.answer) {
                            finalAnswer = textData.answer;
                        }
                    }
                    if (data.answer) {
                        finalAnswer = data.answer;
                    }
                } catch (e) {
                    // Ignore parse errors in SSE stream
                }
            }
        }

        return finalAnswer || 'No response from Perplexity';
    }

    toAnthropicFormat(answer, model) {
        return {
            id: `msg_pplx_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: answer }],
            model: `perplexity-${model}`,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
        };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.isInitialized = false;
        }
    }
}

// Singleton instance
let browserClient = null;

export function getPerplexityBrowserClient() {
    if (!browserClient) {
        browserClient = new PerplexityBrowserClient();
    }
    return browserClient;
}

export { PerplexityBrowserClient };
