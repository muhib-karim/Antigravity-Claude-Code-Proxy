/**
 * tool_result blocks must reach Gemini as functionResponse parts named after the tool
 * (Gemini pairs responses with calls by function name), not after the tool_use id.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertContentToParts } from '../../src/format/content-converter.js';
import { convertAnthropicToGoogle } from '../../src/format/request-converter.js';

describe('functionResponse naming', () => {
    it('uses the tool name from the id map when one is provided', () => {
        const parts = convertContentToParts(
            [{ type: 'tool_result', tool_use_id: 'toolu_7', content: 'done' }],
            false,
            true,
            new Map([['toolu_7', 'run_tests']])
        );
        assert.equal(parts[0].functionResponse.name, 'run_tests');
        assert.deepEqual(parts[0].functionResponse.response, { result: 'done' });
    });

    it('falls back to the tool_use id when the call is not in the history', () => {
        const parts = convertContentToParts([{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'r' }]);
        assert.equal(parts[0].functionResponse.name, 'toolu_x');
    });

    it('resolves names across the whole conversation in convertAnthropicToGoogle', () => {
        const google = convertAnthropicToGoogle({
            model: 'gemini-3-flash',
            max_tokens: 32,
            messages: [
                { role: 'user', content: 'list files' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_a', name: 'ls', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'a.txt' }] }
            ]
        });
        assert.equal(google.contents[2].parts[0].functionResponse.name, 'ls');
    });
});
