/**
 * Unit tests for Anthropic Messages request validation and routing-header checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessagesRequest, validateRoutingHeaders } from '../../src/http/validation.js';

const valid = () => ({
    model: 'gemini-3-flash',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }]
});

describe('validateMessagesRequest', () => {
    it('accepts a minimal valid request', () => {
        assert.deepEqual(validateMessagesRequest(valid()), []);
    });

    it('accepts a full request with blocks, tools, system and sampling params', () => {
        const body = {
            ...valid(),
            stream: true,
            system: [{ type: 'text', text: 'Be brief', cache_control: { type: 'ephemeral' } }],
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            stop_sequences: ['END'],
            metadata: { user_id: 'u1' },
            thinking: { type: 'enabled', budget_tokens: 1024 },
            tool_choice: { type: 'tool', name: 'get_weather' },
            tools: [
                { name: 'get_weather', description: 'd', input_schema: { type: 'object', properties: {} } },
                { type: 'web_search_20250305', name: 'web_search' }
            ],
            messages: [
                { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} }] },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny' }]
                },
                { role: 'assistant', content: [{ type: 'thinking', thinking: '...', signature: 's' }] }
            ]
        };
        assert.deepEqual(validateMessagesRequest(body), []);
    });

    it('rejects a non-object body', () => {
        for (const body of [undefined, null, 'x', 42, []]) {
            assert.deepEqual(validateMessagesRequest(body), ['body: must be a JSON object'], String(body));
        }
    });

    it('requires a non-empty messages array', () => {
        assert.deepEqual(validateMessagesRequest({ model: 'm' }), ['messages: is required and must be an array']);
        assert.deepEqual(validateMessagesRequest({ ...valid(), messages: [] }), ['messages: must not be empty']);
    });

    it('checks every message role and content', () => {
        const problems = validateMessagesRequest({
            ...valid(),
            messages: [
                { role: 'system', content: 'x' },
                { role: 'user' },
                { role: 'user', content: [{ text: 'no type' }] },
                'not an object'
            ]
        });
        assert.deepEqual(problems, [
            'messages[0].role: must be "user" or "assistant"',
            'messages[1].content: must be a string or an array of content blocks',
            'messages[2].content[0].type: must be a string',
            'messages[3]: must be an object'
        ]);
    });

    it('checks the shape of text, tool_use and tool_result blocks', () => {
        const problems = validateMessagesRequest({
            ...valid(),
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 5 },
                        { type: 'tool_use', name: 'x', input: 'nope' }
                    ]
                },
                { role: 'user', content: [{ type: 'tool_result' }] }
            ]
        });
        assert.deepEqual(problems, [
            'messages[0].content[0].text: must be a string',
            'messages[0].content[1].id: must be a non-empty string',
            'messages[0].content[1].input: must be an object',
            'messages[1].content[0].tool_use_id: must be a non-empty string'
        ]);
    });

    it('validates scalar parameters', () => {
        const problems = validateMessagesRequest({
            ...valid(),
            model: '',
            max_tokens: 0,
            stream: 'yes',
            temperature: 3,
            top_p: -0.1,
            top_k: 1.5,
            stop_sequences: ['ok', 1],
            metadata: 'm'
        });
        assert.deepEqual(problems, [
            'model: must be a non-empty string',
            'max_tokens: must be a positive integer',
            'stream: must be a boolean',
            'temperature: must be a number between 0 and 1',
            'top_p: must be a number between 0 and 1',
            'top_k: must be a non-negative integer',
            'stop_sequences: must be an array of strings',
            'metadata: must be an object'
        ]);
    });

    it('validates system, tools, tool_choice and thinking', () => {
        const problems = validateMessagesRequest({
            ...valid(),
            system: [{ type: 'image' }],
            tools: [{ description: 'no name' }, { name: 'ok', input_schema: 'bad' }],
            tool_choice: { type: 'tool' },
            thinking: { type: 'enabled' }
        });
        assert.deepEqual(problems, [
            'system: must be a string or an array of text blocks',
            'tools[0].name: must be a non-empty string',
            'tools[1].input_schema: must be an object',
            'tool_choice.name: is required when tool_choice.type is "tool"',
            'thinking.budget_tokens: must be a positive integer when thinking is enabled'
        ]);
        assert.deepEqual(validateMessagesRequest({ ...valid(), tools: 'x', tool_choice: { type: 'maybe' } }), [
            'tools: must be an array',
            'tool_choice.type: must be one of auto, any, tool, none'
        ]);
        assert.deepEqual(validateMessagesRequest({ ...valid(), thinking: { type: 'sometimes' } }), [
            'thinking.type: must be one of enabled, disabled, adaptive'
        ]);
    });

    it('caps the number of reported problems', () => {
        const messages = Array.from({ length: 50 }, () => ({ role: 'bot', content: 'x' }));
        const problems = validateMessagesRequest({ ...valid(), messages });
        assert.equal(problems.length, 11);
        assert.equal(problems[10], '...and 40 more problems');
    });
});

describe('validateRoutingHeaders', () => {
    it('accepts absent and well-formed routing headers', () => {
        assert.deepEqual(validateRoutingHeaders({}), []);
        assert.deepEqual(
            validateRoutingHeaders({ 'x-session-id': '_home_me_my project', 'x-override-model': 'gemini-3-pro-high' }),
            []
        );
    });

    it('rejects oversized or malformed values', () => {
        assert.deepEqual(validateRoutingHeaders({ 'x-session-id': 'a'.repeat(257) }), [
            'x-session-id: must be 1-256 printable characters'
        ]);
        assert.deepEqual(validateRoutingHeaders({ 'x-override-model': 'gemini 3; rm -rf' }), [
            'x-override-model: must be 1-128 characters of letters, digits, ".", "_", ":", "/" or "-"'
        ]);
        assert.deepEqual(validateRoutingHeaders({ 'x-session-id': ['a', 'b'] }), [
            'x-session-id: must be 1-256 printable characters'
        ]);
    });
});
