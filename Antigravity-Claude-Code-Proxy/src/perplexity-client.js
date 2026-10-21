// Perplexity Client


const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';
const SYSTEM_PROMPT = "You are a helpful AI assistant. You answer queries accurately and concisely.";

export class PerplexityClient {
    constructor(accountManager) {
        this.accountManager = accountManager;
    }

    /**
     * Convert Anthropic Message format to OpenAI/Perplexity format
     */
    convertToOpenAI(anthropicRequest) {
        const messages = [];

        // Add system prompt if present
        if (anthropicRequest.system) {
            messages.push({ role: 'system', content: anthropicRequest.system });
        } else {
            messages.push({ role: 'system', content: SYSTEM_PROMPT });
        }

        // Convert messages
        for (const msg of anthropicRequest.messages) {
            let content = msg.content;
            // Handle array content (extract text)
            if (Array.isArray(content)) {
                content = content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
            }
            messages.push({ role: msg.role, content });
        }

        return {
            model: anthropicRequest.model || 'sonar-pro',
            messages: messages,
            temperature: anthropicRequest.temperature,
            top_p: anthropicRequest.top_p,
            max_tokens: anthropicRequest.max_tokens,
            stream: false
        };
    }

    /**
     * Convert OpenAI/Perplexity response to Anthropic format
     */
    convertToAnthropic(openAIResponse) {
        const choice = openAIResponse.choices[0];
        return {
            id: openAIResponse.id,
            type: 'message',
            role: 'assistant',
            content: [
                {
                    type: 'text',
                    text: choice.message.content
                }
            ],
            model: openAIResponse.model,
            stop_reason: choice.finish_reason === 'stop' ? 'end_turn' : 'max_tokens',
            stop_sequence: null,
            usage: {
                input_tokens: openAIResponse.usage?.prompt_tokens || 0,
                output_tokens: openAIResponse.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * Send message to Perplexity API with account rotation and retries
     */
    async sendMessage(messages, model, system) {
        const anthropicRequest = {
            messages,
            model,
            system
        };

        const payload = this.convertToOpenAI(anthropicRequest);
        let attempts = 0;
        const maxAttempts = 5; // Retry up to 5 times (or number of accounts)

        while (attempts < maxAttempts) {
            attempts++;
            const account = this.accountManager.getAvailableAccount();

            if (!account) {
                // If checking the first time and no accounts, maybe they provided ENV var as fallback?
                // For now, strict requirements on AccountManager
                console.error('[Perplexity] No available accounts.');
                throw new Error('No available Perplexity accounts found. Please add accounts via `npm run login:perplexity`.');
            }

            const apiKey = account.apiKey;
            console.log(`[Perplexity] Using the next available account for ${payload.model}`);

            try {
                const response = await fetch(`${PERPLEXITY_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.status === 429 || response.status === 403) {
                    console.warn(`[Perplexity] Rate limit/quota hit (${response.status}); rotating to the next account`);
                    await this.accountManager.markRateLimited(apiKey);
                    continue; // Retry with next account
                }

                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(`Perplexity API Error (${response.status}): ${error}`);
                }

                const data = await response.json();
                await this.accountManager.updateUsage(apiKey);
                return this.convertToAnthropic(data);

            } catch (err) {
                console.error('[Perplexity] Request failed:', err.message);
                // If network error, might want to retry? For now, if it's not rate limit, rethrow.
                // But catching fetch errors (network) is good.
                if (err.message.includes('fetch failed')) {
                    continue;
                }
                throw err;
            }
        }

        throw new Error('Perplexity request failed after retries.');
    }

    async listModels() {
        return [
            { id: 'sonar-pro', description: 'Perplexity Sonar Pro (Deep Research)' },
            { id: 'sonar', description: 'Perplexity Sonar (Fast)' }
        ];
    }
}
