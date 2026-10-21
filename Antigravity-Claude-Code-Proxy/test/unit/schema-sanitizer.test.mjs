/**
 * Unit tests for cleanSchemaForGemini: tool input schemas from Claude Code (often
 * generated from Zod/Pydantic) must be reduced to the subset Gemini accepts while
 * keeping constraints visible to the model as description hints.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSchemaForGemini } from '../../src/format/schema-sanitizer.js';

const UNSUPPORTED = [
    '$schema',
    '$defs',
    'definitions',
    '$ref',
    '$id',
    'additionalProperties',
    'default',
    'title',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'examples',
    'allOf',
    'anyOf',
    'oneOf',
    'const'
];

/** Collect every key used anywhere in a schema tree. */
function allKeys(node, keys = new Set()) {
    if (Array.isArray(node)) node.forEach(n => allKeys(n, keys));
    else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
            keys.add(k);
            allKeys(v, keys);
        }
    }
    return keys;
}

const complex = () => ({
    type: 'object',
    $schema: 'http://json-schema.org/draft-07/schema#',
    additionalProperties: false,
    $defs: { Point: { type: 'object' } },
    properties: {
        ref: { $ref: '#/$defs/Point' },
        mode: { type: 'string', enum: ['fast', 'slow'], default: 'fast' },
        name: { type: 'string', minLength: 1, maxLength: 10, pattern: '^a', format: 'email' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
        maybe: { type: ['string', 'null'], description: 'Optional' },
        choice: { anyOf: [{ type: 'string' }, { type: 'object', properties: { a: { type: 'number' } } }] },
        merged: {
            allOf: [
                { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
                { properties: { y: { type: 'integer' } }, required: ['y'] }
            ]
        },
        fixed: { const: 'v1' }
    },
    required: ['ref', 'maybe', 'name', 'ghost']
});

describe('cleanSchemaForGemini', () => {
    it('removes every keyword Gemini rejects, at any depth', () => {
        const keys = allKeys(cleanSchemaForGemini(complex()));
        for (const k of UNSUPPORTED) assert.ok(!keys.has(k), `${k} should be removed`);
    });

    it('turns $ref into an object with a "See:" hint', () => {
        assert.deepEqual(cleanSchemaForGemini(complex()).properties.ref, { type: 'object', description: 'See: Point' });
    });

    it('keeps enums and adds each constraint hint exactly once', () => {
        const out = cleanSchemaForGemini(complex()).properties;
        assert.deepEqual(out.mode.enum, ['fast', 'slow']);
        assert.equal(out.mode.description, 'Allowed: fast, slow');
        assert.equal(out.name.description, 'minLength: 1 (maxLength: 10) (pattern: ^a) (format: email)');
        assert.equal(out.tags.description, 'minItems: 1 (maxItems: 5)');
    });

    it('collapses nullable type arrays and drops them from required', () => {
        const out = cleanSchemaForGemini(complex());
        assert.deepEqual(out.properties.maybe, { type: 'string', description: 'Optional (nullable)' });
        assert.deepEqual(out.required, ['ref', 'name'], 'nullable and unknown properties are not required');
    });

    it('picks the richest anyOf option and lists the alternatives', () => {
        const choice = cleanSchemaForGemini(complex()).properties.choice;
        assert.equal(choice.type, 'object');
        assert.deepEqual(choice.properties, { a: { type: 'number' } });
        assert.equal(choice.description, 'Accepts: string | object');
    });

    it('merges allOf properties and required lists', () => {
        const merged = cleanSchemaForGemini(complex()).properties.merged;
        assert.deepEqual(merged.properties, { x: { type: 'string' }, y: { type: 'integer' } });
        assert.deepEqual(merged.required, ['x', 'y']);
    });

    it('converts const to a single-value enum', () => {
        const fixed = cleanSchemaForGemini(complex()).properties.fixed;
        assert.deepEqual(fixed.enum, ['v1']);
        assert.equal(fixed.const, undefined);
    });

    it('notes closed objects in the description', () => {
        assert.match(cleanSchemaForGemini(complex()).description, /No extra properties allowed/);
    });

    it('is idempotent', () => {
        const once = cleanSchemaForGemini(complex());
        assert.deepEqual(cleanSchemaForGemini(structuredClone(once)), once);
    });

    it('passes non-objects through and maps arrays', () => {
        assert.equal(cleanSchemaForGemini(null), null);
        assert.deepEqual(cleanSchemaForGemini([{ type: 'string', title: 't' }]), [{ type: 'string' }]);
    });
});
