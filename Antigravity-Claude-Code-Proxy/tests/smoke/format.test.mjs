/**
 * Unit tests for the Anthropic <-> Google format converters and model helpers.
 * Pure functions only - no network, no server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    convertAnthropicToGoogle,
    convertGoogleToAnthropic,
    sanitizeSchema
} from '../../src/format/index.js';
import {
    resolveModelAlias,
    isThinkingModel,
    getModelFamily
} from '../../src/constants.js';
import { formatDuration } from '../../src/utils/helpers.js';
import { RateLimitError, isRateLimitError, isAuthError, AuthError } from '../../src/errors.js';

describe('convertAnthropicToGoogle', () => {
    it('maps messages, system prompt, max_tokens and tools', () => {
        const google = convertAnthropicToGoogle({
            model: 'gemini-3-flash',
            max_tokens: 100,
            system: 'be brief',
            messages: [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }
            ],
            tools: [{
                name: 'read',
                description: 'Read a file',
                input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
            }]
        });

        assert.deepEqual(google.systemInstruction, { parts: [{ text: 'be brief' }] });
        assert.equal(google.generationConfig.maxOutputTokens, 100);
        assert.deepEqual(google.contents.map(c => c.role), ['user', 'model', 'user']);
        assert.deepEqual(google.contents[0].parts, [{ text: 'hi' }]);
        assert.deepEqual(google.contents[1].parts[0].functionCall, { name: 'read', args: { path: 'a' } });
        assert.ok(google.contents[2].parts[0].functionResponse, 'tool_result becomes a functionResponse');

        const decl = google.tools[0].functionDeclarations[0];
        assert.equal(decl.name, 'read');
        assert.equal(decl.parameters.additionalProperties, undefined, 'unsupported schema keys are stripped');
        assert.deepEqual(decl.parameters.required, ['path']);
    });
});

describe('convertGoogleToAnthropic', () => {
    it('converts a text response with usage', () => {
        const msg = convertGoogleToAnthropic({
            response: {
                candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, cachedContentTokenCount: 4 }
            }
        }, 'gemini-3-flash');

        assert.equal(msg.type, 'message');
        assert.equal(msg.role, 'assistant');
        assert.equal(msg.model, 'gemini-3-flash');
        assert.deepEqual(msg.content, [{ type: 'text', text: 'Hello' }]);
        assert.equal(msg.stop_reason, 'end_turn');
        assert.deepEqual(msg.usage, {
            input_tokens: 6,
            output_tokens: 3,
            cache_read_input_tokens: 4,
            cache_creation_input_tokens: 0
        });
    });

    it('reports tool_use when Gemini returns a function call with finishReason STOP', () => {
        const msg = convertGoogleToAnthropic({
            candidates: [{ content: { parts: [{ functionCall: { name: 'read', args: { path: 'b' } } }] }, finishReason: 'STOP' }]
        }, 'gemini-3-flash');

        assert.equal(msg.content[0].type, 'tool_use');
        assert.equal(msg.content[0].name, 'read');
        assert.deepEqual(msg.content[0].input, { path: 'b' });
        assert.match(msg.content[0].id, /^toolu_/);
        assert.equal(msg.stop_reason, 'tool_use');
    });

    it('maps MAX_TOKENS to max_tokens and thought parts to thinking blocks', () => {
        const msg = convertGoogleToAnthropic({
            candidates: [{
                content: { parts: [{ text: 'pondering', thought: true, thoughtSignature: 'sig' }, { text: 'partial' }] },
                finishReason: 'MAX_TOKENS'
            }]
        }, 'claude-sonnet-4-5-thinking');

        assert.equal(msg.stop_reason, 'max_tokens');
        assert.deepEqual(msg.content[0], { type: 'thinking', thinking: 'pondering', signature: 'sig' });
        assert.deepEqual(msg.content[1], { type: 'text', text: 'partial' });
    });
});

describe('sanitizeSchema', () => {
    it('drops keywords the Cloud Code API rejects', () => {
        const out = sanitizeSchema({
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            additionalProperties: false,
            properties: { url: { type: 'string', format: 'uri', default: 'x' } }
        });
        assert.deepEqual(out, { type: 'object', properties: { url: { type: 'string' } } });
    });
});

describe('model helpers', () => {
    it('resolves aliases case-insensitively and passes unknown names through', () => {
        assert.equal(resolveModelAlias('Flash'), 'gemini-3-flash');
        assert.equal(resolveModelAlias('pro'), 'gemini-3-pro-high');
        assert.equal(resolveModelAlias('claude-3-5-sonnet-20241022'), 'claude-sonnet-4-5-thinking');
        assert.equal(resolveModelAlias('some-custom-model'), 'some-custom-model');
    });

    it('detects thinking models and model families', () => {
        assert.equal(isThinkingModel('claude-opus-4-5-thinking'), true);
        assert.equal(isThinkingModel('gemini-3-pro-high'), true);
        assert.equal(isThinkingModel('gemini-3-flash'), false);
        assert.equal(isThinkingModel('claude-sonnet-4-5'), false);
        assert.equal(getModelFamily('claude-sonnet-4-5'), 'claude');
        assert.equal(getModelFamily('gemini-3-pro-high'), 'gemini');
        assert.equal(getModelFamily('pplx-grok'), 'unknown');
    });

    it('formats durations', () => {
        assert.equal(formatDuration(3723000), '1h2m3s');
        assert.equal(formatDuration(61000), '1m1s');
    });
});

describe('errors', () => {
    it('classifies custom and legacy string errors', () => {
        assert.equal(isRateLimitError(new RateLimitError('slow down')), true);
        assert.equal(isRateLimitError(new Error('429 RESOURCE_EXHAUSTED')), true);
        assert.equal(isRateLimitError(new Error('boom')), false);
        assert.equal(isRateLimitError(new Error('prompt used 14290 tokens')), false);
        assert.equal(isAuthError(new AuthError('expired')), true);
    });
});
