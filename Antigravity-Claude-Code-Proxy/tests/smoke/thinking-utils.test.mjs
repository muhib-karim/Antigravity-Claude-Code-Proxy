/**
 * Unit tests for thinking-block handling and the thinking-recovery logic.
 * Pure functions only - no network, no server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isThinkingPart,
    hasValidSignature,
    filterUnsignedThinkingBlocks,
    removeTrailingThinkingBlocks,
    restoreThinkingSignatures,
    reorderAssistantContent,
    analyzeConversationState,
    needsThinkingRecovery,
    closeToolLoopForThinking
} from '../../src/format/thinking-utils.js';
import { MIN_SIGNATURE_LENGTH } from '../../src/constants.js';

const SIG = 's'.repeat(MIN_SIGNATURE_LENGTH);
const SHORT_SIG = 's'.repeat(MIN_SIGNATURE_LENGTH - 1);

describe('thinking block detection', () => {
    it('recognises Anthropic and Gemini thinking parts', () => {
        assert.equal(isThinkingPart({ type: 'thinking', thinking: 'x' }), true);
        assert.equal(isThinkingPart({ type: 'redacted_thinking', data: 'x' }), true);
        assert.equal(isThinkingPart({ thought: true, text: 'x' }), true);
        assert.equal(isThinkingPart({ type: 'text', text: 'x' }), false);
    });

    it('requires a signature of at least MIN_SIGNATURE_LENGTH characters', () => {
        assert.equal(hasValidSignature({ type: 'thinking', signature: SIG }), true);
        assert.equal(hasValidSignature({ type: 'thinking', signature: SHORT_SIG }), false);
        assert.equal(hasValidSignature({ thought: true, thoughtSignature: SIG }), true);
        assert.equal(hasValidSignature({ thought: true, signature: SIG }), false);
    });
});

describe('thinking block filtering', () => {
    it('drops unsigned Gemini thought parts and strips extra fields from signed ones', () => {
        const [content] = filterUnsignedThinkingBlocks([{
            role: 'model',
            parts: [
                { thought: true, text: 'unsigned' },
                { thought: true, text: 'signed', thoughtSignature: SIG, extra: 1 },
                { text: 'answer' }
            ]
        }]);
        assert.deepEqual(content.parts, [
            { thought: true, text: 'signed', thoughtSignature: SIG },
            { text: 'answer' }
        ]);
    });

    it('removes only trailing unsigned thinking blocks', () => {
        const content = [
            { type: 'thinking', thinking: 'early', signature: SHORT_SIG },
            { type: 'text', text: 'hi' },
            { type: 'thinking', thinking: 'late 1' },
            { type: 'thinking', thinking: 'late 2', signature: SHORT_SIG }
        ];
        assert.deepEqual(removeTrailingThinkingBlocks(content), content.slice(0, 2));

        const signedTail = [{ type: 'text', text: 'hi' }, { type: 'thinking', thinking: 't', signature: SIG }];
        assert.equal(removeTrailingThinkingBlocks(signedTail), signedTail);
    });

    it('keeps signed thinking blocks without cache_control', () => {
        const out = restoreThinkingSignatures([
            { type: 'thinking', thinking: 'a', signature: SIG, cache_control: { type: 'ephemeral' } },
            { type: 'thinking', thinking: 'b' },
            { type: 'text', text: 'c' }
        ]);
        assert.deepEqual(out, [
            { type: 'thinking', thinking: 'a', signature: SIG },
            { type: 'text', text: 'c' }
        ]);
    });

    it('orders assistant content as thinking, text, tool_use and drops empty text', () => {
        const out = reorderAssistantContent([
            { type: 'tool_use', id: 't1', name: 'read', input: {} },
            { type: 'text', text: '   ' },
            { type: 'text', text: 'hello' },
            { type: 'thinking', thinking: 'plan', signature: SIG, cache_control: {} }
        ]);
        assert.deepEqual(out.map(b => b.type), ['thinking', 'text', 'tool_use']);
        assert.equal(out[0].cache_control, undefined);
    });
});

describe('thinking recovery', () => {
    const toolUse = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read', input: {} }] };
    const toolResult = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] };

    it('reports an empty state for conversations without an assistant turn', () => {
        assert.deepEqual(analyzeConversationState([{ role: 'user', content: 'hi' }]), {
            inToolLoop: false, interruptedTool: false, turnHasThinking: false, toolResultCount: 0
        });
        assert.equal(needsThinkingRecovery([]), false);
    });

    it('closes an unsigned tool loop with synthetic assistant and user turns', () => {
        const messages = [{ role: 'user', content: 'go' }, toolUse, toolResult];
        assert.equal(needsThinkingRecovery(messages), true);

        const out = closeToolLoopForThinking(messages);
        assert.equal(out.length, 5);
        assert.deepEqual(out[3], { role: 'assistant', content: [{ type: 'text', text: '[Tool execution completed.]' }] });
        assert.deepEqual(out[4], { role: 'user', content: [{ type: 'text', text: '[Continue]' }] });
    });

    it('acknowledges an interrupted tool call before the next user message', () => {
        const messages = [{ role: 'user', content: 'go' }, toolUse, { role: 'user', content: [{ type: 'text', text: 'stop' }] }];
        const state = analyzeConversationState(messages);
        assert.equal(state.interruptedTool, true);
        assert.equal(state.inToolLoop, false);

        const out = closeToolLoopForThinking(messages);
        assert.deepEqual(out[2], { role: 'assistant', content: [{ type: 'text', text: '[Tool call was interrupted.]' }] });
        assert.equal(out[3].content[0].text, 'stop');
    });

    it('leaves a tool loop alone when the turn has signed thinking', () => {
        const signed = { role: 'assistant', content: [{ type: 'thinking', thinking: 'p', signature: SIG }, ...toolUse.content] };
        const messages = [{ role: 'user', content: 'go' }, signed, toolResult];
        assert.equal(needsThinkingRecovery(messages), false);
    });
});
