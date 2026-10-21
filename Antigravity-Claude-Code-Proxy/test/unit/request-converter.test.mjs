/**
 * Unit tests for convertAnthropicToGoogle beyond the conformance fixtures: tool
 * definitions in other client shapes, name normalisation, schema cleaning per model
 * family, Gemini output caps and thinking configuration.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertAnthropicToGoogle } from '../../src/format/request-converter.js';
import { GEMINI_MAX_OUTPUT_TOKENS } from '../../src/constants.js';

const base = (model, extra = {}) => ({
    model,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hi' }],
    ...extra
});

describe('convertAnthropicToGoogle tools', () => {
    it('accepts OpenAI-style and custom tool shapes and normalises names', () => {
        const google = convertAnthropicToGoogle(
            base('gemini-3-flash', {
                tools: [
                    {
                        function: {
                            name: 'open.file',
                            description: 'Open',
                            parameters: { type: 'object', properties: { p: { type: 'string' } } }
                        }
                    },
                    {
                        custom: {
                            name: 'run tests',
                            description: 'Run',
                            input_schema: { type: 'object', properties: { n: { type: 'integer' } } }
                        }
                    },
                    { parameters: { type: 'object', properties: { q: { type: 'string' } } } }
                ]
            })
        );
        const decls = google.tools[0].functionDeclarations;
        assert.deepEqual(
            decls.map(d => d.name),
            ['open_file', 'run_tests', 'tool-2']
        );
        assert.equal(decls[0].description, 'Open');
        assert.deepEqual(Object.keys(decls[1].parameters.properties), ['n']);
        assert.deepEqual(Object.keys(decls[2].parameters.properties), ['q']);
    });

    it('caps tool names at 64 characters', () => {
        const google = convertAnthropicToGoogle(
            base('gemini-3-flash', { tools: [{ name: 'x'.repeat(80), input_schema: { type: 'object' } }] })
        );
        assert.equal(google.tools[0].functionDeclarations[0].name.length, 64);
    });

    it('cleans schemas for Gemini but not for Claude models', () => {
        const tool = {
            name: 't',
            input_schema: { type: 'object', properties: { s: { type: 'string', enum: ['a', 'b'] } } }
        };
        const gemini = convertAnthropicToGoogle(base('gemini-3-flash', { tools: [tool] }));
        const claude = convertAnthropicToGoogle(base('claude-sonnet-4-5', { tools: [tool] }));
        assert.equal(gemini.tools[0].functionDeclarations[0].parameters.properties.s.description, 'Allowed: a, b');
        assert.equal(claude.tools[0].functionDeclarations[0].parameters.properties.s.description, undefined);
    });
});

describe('convertAnthropicToGoogle generation config', () => {
    it('caps max_tokens for Gemini models only', () => {
        const huge = GEMINI_MAX_OUTPUT_TOKENS + 1000;
        assert.equal(
            convertAnthropicToGoogle(base('gemini-3-flash', { max_tokens: huge })).generationConfig.maxOutputTokens,
            GEMINI_MAX_OUTPUT_TOKENS
        );
        assert.equal(
            convertAnthropicToGoogle(base('claude-sonnet-4-5', { max_tokens: huge })).generationConfig.maxOutputTokens,
            huge
        );
    });

    it('enables Claude thinking without a budget when none is given', () => {
        const google = convertAnthropicToGoogle(base('claude-opus-4-5-thinking'));
        assert.deepEqual(google.generationConfig.thinkingConfig, { include_thoughts: true });
    });

    it('does not enable thinking for non-thinking models', () => {
        assert.equal(convertAnthropicToGoogle(base('gemini-3-flash')).generationConfig.thinkingConfig, undefined);
    });

    it('converts string and block system prompts', () => {
        assert.deepEqual(convertAnthropicToGoogle(base('gemini-3-flash', { system: 'S' })).systemInstruction.parts[0], {
            text: 'S'
        });
        const blocks = convertAnthropicToGoogle(
            base('gemini-3-flash', {
                system: [
                    { type: 'text', text: 'A' },
                    { type: 'text', text: 'B' }
                ]
            })
        );
        assert.deepEqual(
            blocks.systemInstruction.parts.slice(0, 2).map(p => p.text),
            ['A', 'B']
        );
    });

    it('keeps at least one part when a message only had thinking blocks', () => {
        const google = convertAnthropicToGoogle(
            base('gemini-3-flash', {
                messages: [
                    { role: 'user', content: 'q' },
                    { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] },
                    { role: 'user', content: 'again' }
                ]
            })
        );
        assert.equal(google.contents[1].role, 'model');
        assert.ok(google.contents[1].parts.length >= 1);
    });
});
