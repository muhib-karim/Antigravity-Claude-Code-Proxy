/**
 * Perplexity Session Client
 * Uses session token from Perplexity Pro subscription to access the internal API
 * Based on: https://github.com/artp1ay/perplexity-openai-api
 */

const API_BASE_URL = 'https://www.perplexity.ai';
const ENDPOINT_ASK = '/rest/sse/perplexity_ask';
const SESSION_COOKIE_NAME = '__Secure-next-auth.session-token';
const API_VERSION = '2.18';

// Model mappings for Perplexity - including all Pro models
const PERPLEXITY_MODELS = {
    // Perplexity's own models
    'perplexity-auto': { identifier: 'default', mode: 'copilot' },
    'perplexity-sonar': { identifier: 'experimental', mode: 'copilot' },
    'perplexity-research': { identifier: 'pplx_alpha', mode: 'copilot' },
    'perplexity-labs': { identifier: 'pplx_beta', mode: 'copilot' },
    'sonar': { identifier: 'experimental', mode: 'copilot' },
    'sonar-pro': { identifier: 'default', mode: 'copilot' },

    // OpenAI models via Perplexity
    'pplx-gpt51': { identifier: 'gpt51', mode: 'copilot' },
    'pplx-gpt52': { identifier: 'gpt52', mode: 'copilot' },
    'pplx-gpt51-thinking': { identifier: 'gpt51_thinking', mode: 'copilot' },

    // Anthropic Claude models via Perplexity
    'pplx-claude-sonnet': { identifier: 'claude45sonnet', mode: 'copilot' },
    'pplx-claude-sonnet-thinking': { identifier: 'claude45sonnetthinking', mode: 'copilot' },
    'pplx-claude-opus': { identifier: 'claudeopus45', mode: 'copilot' },

    // Google Gemini via Perplexity
    'pplx-gemini-pro': { identifier: 'gemini30pro', mode: 'copilot' },
    'pplx-gemini-flash': { identifier: 'gemini30flash', mode: 'copilot' },

    // xAI Grok via Perplexity
    'pplx-grok': { identifier: 'grok41nonreasoning', mode: 'copilot' },

    // Kimi via Perplexity
    'pplx-kimi': { identifier: 'kimik2thinking', mode: 'copilot' },
};

export class PerplexitySessionClient {
    constructor(accountManager) {
        this.accountManager = accountManager;
    }

    /**
     * Build request payload for Perplexity API
     */
    buildPayload(query, model = 'perplexity-auto') {
        const modelConfig = PERPLEXITY_MODELS[model.toLowerCase()] || PERPLEXITY_MODELS['perplexity-auto'];

        return {
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
    }

    /**
     * Convert Anthropic Messages format to Perplexity query string
     */
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

    /**
     * Extract text content from message content (handles string or array)
     */
    extractTextContent(content) {
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
        }
        return '';
    }

    /**
     * Send message to Perplexity API
     */
    async sendMessage(messages, model, system) {
        const query = system
            ? `[System]\n${system}\n\n${this.messagesToQuery(messages)}`
            : this.messagesToQuery(messages);

        const payload = this.buildPayload(query, model);

        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            const account = this.accountManager.getAvailableAccount();

            if (!account) {
                console.error('[PerplexitySession] No available accounts.');
                throw new Error('No available Perplexity accounts. Add accounts via dashboard.');
            }

            const sessionToken = account.sessionToken;
            console.log(`[PerplexitySession] Using account: ${account.email || 'unknown'}`);

            try {
                const response = await this.makeRequest(sessionToken, payload);
                await this.accountManager.updateUsage(account.email || account.sessionToken);
                return response;
            } catch (err) {
                console.error(`[PerplexitySession] Error:`, err.message);

                if (err.message.includes('403') || err.message.includes('401')) {
                    await this.accountManager.markRateLimited(account.email || account.sessionToken);
                    continue; // Try next account
                }

                throw err;
            }
        }

        throw new Error('Perplexity request failed after all retries.');
    }

    /**
     * Make HTTP request to Perplexity API
     */
    async makeRequest(sessionToken, payload) {
        const url = `${API_BASE_URL}${ENDPOINT_ASK}`;

        const headers = {
            'Accept': 'text/event-stream, application/json',
            'Content-Type': 'application/json',
            'Referer': `${API_BASE_URL}/`,
            'Origin': API_BASE_URL,
            'Cookie': `${SESSION_COOKIE_NAME}=${sessionToken}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
        });

        if (response.status === 403) {
            throw new Error('403 Authentication failed. Session token may be expired.');
        }

        if (response.status === 429) {
            throw new Error('429 Rate limit exceeded.');
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Perplexity API Error (${response.status}): ${text.substring(0, 200)}`);
        }

        // Parse SSE response
        const text = await response.text();
        const answer = this.parseSSEResponse(text);

        // Convert to Anthropic format
        return this.toAnthropicFormat(answer, payload.params.model_preference);
    }

    /**
     * Parse SSE (Server-Sent Events) response
     */
    parseSSEResponse(sseText) {
        const lines = sseText.split('\n');
        let finalAnswer = '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.substring(6));

                    // Extract answer from different response formats
                    if (data.text) {
                        const textData = typeof data.text === 'string'
                            ? JSON.parse(data.text)
                            : data.text;

                        if (Array.isArray(textData)) {
                            for (const item of textData) {
                                if (item.step_type === 'FINAL' && item.content?.answer) {
                                    const answerContent = item.content.answer;
                                    if (typeof answerContent === 'string') {
                                        try {
                                            const parsed = JSON.parse(answerContent);
                                            finalAnswer = parsed.answer || answerContent;
                                        } catch {
                                            finalAnswer = answerContent;
                                        }
                                    } else if (answerContent.answer) {
                                        finalAnswer = answerContent.answer;
                                    }
                                }
                            }
                        } else if (textData.answer) {
                            finalAnswer = textData.answer;
                        }
                    }

                    // Check if this is the final chunk
                    if (data.final && finalAnswer) {
                        break;
                    }
                } catch {
                    // Skip malformed JSON lines
                }
            }
        }

        return finalAnswer || 'No response received from Perplexity.';
    }

    /**
     * Convert response to Anthropic Messages API format
     */
    toAnthropicFormat(answer, model) {
        return {
            id: `msg_pplx_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [
                {
                    type: 'text',
                    text: answer,
                }
            ],
            model: model || 'perplexity-auto',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
                input_tokens: 0,
                output_tokens: Math.ceil(answer.length / 4),
            },
        };
    }

    /**
     * List available Perplexity models
     */
    async listModels() {
        return [
            // Perplexity native
            { id: 'perplexity-auto', description: 'Perplexity Auto (Best for most queries)' },
            { id: 'perplexity-sonar', description: 'Perplexity Sonar (Fast responses)' },
            { id: 'perplexity-research', description: 'Perplexity Research (Deep analysis)' },
            { id: 'perplexity-labs', description: 'Perplexity Labs (Experimental)' },
            // OpenAI via Perplexity
            { id: 'pplx-gpt51', description: 'GPT-5.1 via Perplexity' },
            { id: 'pplx-gpt52', description: 'GPT-5.2 via Perplexity' },
            { id: 'pplx-gpt51-thinking', description: 'GPT-5.1 Thinking via Perplexity' },
            // Anthropic via Perplexity
            { id: 'pplx-claude-sonnet', description: 'Claude 4.5 Sonnet via Perplexity' },
            { id: 'pplx-claude-sonnet-thinking', description: 'Claude 4.5 Sonnet Thinking via Perplexity' },
            { id: 'pplx-claude-opus', description: 'Claude Opus 4.5 via Perplexity' },
            // Google via Perplexity
            { id: 'pplx-gemini-pro', description: 'Gemini 3 Pro via Perplexity' },
            { id: 'pplx-gemini-flash', description: 'Gemini 3 Flash via Perplexity' },
            // xAI via Perplexity
            { id: 'pplx-grok', description: 'Grok 4.1 via Perplexity' },
            // Moonshot via Perplexity
            { id: 'pplx-kimi', description: 'Kimi K2 Thinking via Perplexity' },
        ];
    }
}
