/**
 * Unit tests for Anthropic content -> Google parts conversion and the
 * thoughtSignature cache it reads from. Pure functions only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convertRole, convertContentToParts } from '../../src/format/content-converter.js';
import { cacheSignature, getCachedSignature, getCacheSize } from '../../src/format/signature-cache.js';
import { GEMINI_SKIP_SIGNATURE, MIN_SIGNATURE_LENGTH } from '../../src/constants.js';

describe('convertRole', () => {
    it('maps assistant to model and everything else to user', () => {
        assert.equal(convertRole('assistant'), 'model');
        assert.equal(convertRole('user'), 'user');
        assert.equal(convertRole('system'), 'user');
    });
});

describe('convertContentToParts', () => {
    it('wraps strings and drops empty text blocks', () => {
        assert.deepEqual(convertContentToParts('hi'), [{ text: 'hi' }]);
        assert.deepEqual(convertContentToParts([{ type: 'text', text: '  ' }, { type: 'text', text: 'a' }]), [{ text: 'a' }]);
    });

    it('converts base64 and URL images and documents', () => {
        const parts = convertContentToParts([
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            { type: 'image', source: { type: 'url', url: 'https://example.com/a.jpg' } },
            { type: 'document', source: { type: 'url', url: 'https://example.com/a.pdf' } }
        ]);
        assert.deepEqual(parts, [
            { inlineData: { mimeType: 'image/png', data: 'AAA' } },
            { fileData: { mimeType: 'image/jpeg', fileUri: 'https://example.com/a.jpg' } },
            { fileData: { mimeType: 'application/pdf', fileUri: 'https://example.com/a.pdf' } }
        ]);
    });

    it('keeps tool ids for Claude models only', () => {
        const blocks = [
            { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a' } },
            { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'l1' }, { type: 'text', text: 'l2' }] }
        ];
        const claude = convertContentToParts(blocks, true, false);
        assert.deepEqual(claude[0], { functionCall: { name: 'read', args: { path: 'a' }, id: 'toolu_1' } });
        assert.deepEqual(claude[1], { functionResponse: { name: 'toolu_1', response: { result: 'l1\nl2' }, id: 'toolu_1' } });

        const other = convertContentToParts(blocks, false, false);
        assert.equal(other[0].functionCall.id, undefined);
        assert.equal(other[1].functionResponse.id, undefined);
    });

    it('adds a thoughtSignature to Gemini tool calls from the block, the cache, or the skip value', () => {
        cacheSignature('toolu_cached', 'cached-signature');
        assert.equal(getCachedSignature('toolu_cached'), 'cached-signature');
        assert.ok(getCacheSize() >= 1);

        const parts = convertContentToParts([
            { type: 'tool_use', id: 'toolu_inline', name: 'a', input: {}, thoughtSignature: 'inline-signature' },
            { type: 'tool_use', id: 'toolu_cached', name: 'b', input: {} },
            { type: 'tool_use', id: 'toolu_unknown', name: 'c', input: {} }
        ], false, true);
        assert.deepEqual(parts.map(p => p.thoughtSignature), ['inline-signature', 'cached-signature', GEMINI_SKIP_SIGNATURE]);
    });

    it('converts signed thinking blocks to Gemini thoughts and drops unsigned ones', () => {
        const sig = 'x'.repeat(MIN_SIGNATURE_LENGTH);
        const parts = convertContentToParts([
            { type: 'thinking', thinking: 'signed', signature: sig },
            { type: 'thinking', thinking: 'unsigned', signature: 'short' }
        ]);
        assert.deepEqual(parts, [{ text: 'signed', thought: true, thoughtSignature: sig }]);
    });
});

describe('signature cache', () => {
    it('ignores empty keys and values', () => {
        const before = getCacheSize();
        cacheSignature('', 'x');
        cacheSignature('id-without-signature', '');
        assert.equal(getCacheSize(), before);
        assert.equal(getCachedSignature(undefined), null);
        assert.equal(getCachedSignature('never-cached'), null);
    });
});
