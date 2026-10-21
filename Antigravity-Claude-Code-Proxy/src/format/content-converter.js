/**
 * Content Converter
 * Converts Anthropic message content to Google Generative AI parts format
 */

import { MIN_SIGNATURE_LENGTH, GEMINI_SKIP_SIGNATURE } from '../constants.js';
import { getCachedSignature } from './signature-cache.js';

/**
 * Convert Anthropic role to Google role
 * @param {string} role - Anthropic role ('user', 'assistant')
 * @returns {string} Google role ('user', 'model')
 */
export function convertRole(role) {
    if (role === 'assistant') return 'model';
    if (role === 'user') return 'user';
    return 'user'; // Default to user
}

/**
 * Convert Anthropic message content to Google Generative AI parts
 * @param {string|Array} content - Anthropic message content
 * @param {boolean} isClaudeModel - Whether the model is a Claude model
 * @param {boolean} isGeminiModel - Whether the model is a Gemini model
 * @param {Map<string, string>} [toolNames] - tool_use id -> tool name, used to name functionResponse parts
 * @returns {Array} Google Generative AI parts array
 */
export function convertContentToParts(content, isClaudeModel = false, isGeminiModel = false, toolNames = new Map()) {
    if (typeof content === 'string') {
        return [{ text: content }];
    }

    if (!Array.isArray(content)) {
        return [{ text: String(content) }];
    }

    const parts = [];

    for (const block of content) {
        if (block.type === 'text') {
            // Skip empty text blocks - they cause API errors
            if (block.text && block.text.trim()) {
                parts.push({ text: block.text });
            }
        } else if (block.type === 'image') {
            // Handle image content
            if (block.source?.type === 'base64') {
                // Base64-encoded image
                parts.push({
                    inlineData: {
                        mimeType: block.source.media_type,
                        data: block.source.data
                    }
                });
            } else if (block.source?.type === 'url') {
                // URL-referenced image
                parts.push({
                    fileData: {
                        mimeType: block.source.media_type || 'image/jpeg',
                        fileUri: block.source.url
                    }
                });
            }
        } else if (block.type === 'document') {
            // Handle document content (e.g. PDF)
            if (block.source?.type === 'base64') {
                parts.push({
                    inlineData: {
                        mimeType: block.source.media_type,
                        data: block.source.data
                    }
                });
            } else if (block.source?.type === 'url') {
                parts.push({
                    fileData: {
                        mimeType: block.source.media_type || 'application/pdf',
                        fileUri: block.source.url
                    }
                });
            }
        } else if (block.type === 'tool_use') {
            // Convert tool_use to functionCall (Google format)
            // For Claude models, include the id field
            const functionCall = {
                name: block.name,
                args: block.input || {}
            };

            if (isClaudeModel && block.id) {
                functionCall.id = block.id;
            }

            // Build the part with functionCall
            const part = { functionCall };

            // For Gemini models, include thoughtSignature at the part level
            // This is required by Gemini 3+ for tool calls to work correctly
            if (isGeminiModel) {
                // Priority: block.thoughtSignature > cache > GEMINI_SKIP_SIGNATURE
                let signature = block.thoughtSignature;

                if (!signature && block.id) {
                    signature = getCachedSignature(block.id);
                    if (signature) {
                        console.log('[ContentConverter] Restored signature from cache for:', block.id);
                    }
                }

                part.thoughtSignature = signature || GEMINI_SKIP_SIGNATURE;
            }

            parts.push(part);
        } else if (block.type === 'tool_result') {
            // Convert tool_result to functionResponse (Google format)
            let responseContent = block.content;
            if (typeof responseContent === 'string') {
                responseContent = { result: responseContent };
            } else if (Array.isArray(responseContent)) {
                const texts = responseContent
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
                responseContent = { result: texts };
            }

            const functionResponse = {
                // Gemini pairs responses with calls by function name; fall back to the id if the call is unknown
                name: toolNames.get(block.tool_use_id) || block.tool_use_id || 'unknown',
                response: responseContent
            };

            // For Claude models, the id field must match the tool_use_id
            if (isClaudeModel && block.tool_use_id) {
                functionResponse.id = block.tool_use_id;
            }

            parts.push({ functionResponse });
        } else if (block.type === 'thinking') {
            // Handle thinking blocks - only those with valid signatures
            if (block.signature && block.signature.length >= MIN_SIGNATURE_LENGTH) {
                // Convert to Gemini format with signature
                parts.push({
                    text: block.thinking,
                    thought: true,
                    thoughtSignature: block.signature
                });
            }
            // Unsigned thinking blocks are dropped upstream
        }
    }

    return parts;
}
