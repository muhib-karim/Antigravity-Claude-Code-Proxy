/**
 * Unit tests for cleanSchemaForGemini: tool input schemas from Claude Code (often
 * generated from Zod/Pydantic) must be reduced to the subset Gemini accepts while
 * keeping constraints visible to the model as description hints.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSchemaForGemini, sanitizeSchema } from '../../src/format/schema-sanitizer.js';

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

describe('cleanSchemaForGemini edge cases', () => {
    const out = () =>
        cleanSchemaForGemini({
            type: 'object',
            properties: {
                tuple: { type: 'array', items: [{ type: 'string', minLength: 2 }, { type: ['integer', 'null'] }] },
                union: { oneOf: [{ type: 'null' }, { type: 'array', items: { type: 'string' } }, { type: 'number' }] },
                refItems: { type: 'array', items: { $ref: '#/definitions/Thing' } },
                open: {}
            }
        }).properties;

    it('cleans tuple-style items arrays element by element', () => {
        assert.deepEqual(out().tuple.items, [
            { type: 'string', description: 'minLength: 2' },
            { type: 'integer', description: 'nullable' }
        ]);
    });

    it('prefers the array option of a oneOf and ignores null in the hint', () => {
        assert.deepEqual(out().union, {
            type: 'array',
            items: { type: 'string' },
            description: 'Accepts: array | number'
        });
    });

    it('turns $ref inside items into an object hint', () => {
        assert.deepEqual(out().refItems.items, { type: 'object', description: 'See: Thing' });
    });

    it('leaves an empty schema alone', () => {
        assert.deepEqual(out().open, {});
    });
});

describe('sanitizeSchema (allow-list fallback)', () => {
    const PLACEHOLDER = {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Reason for calling this tool' } },
        required: ['reason']
    };

    it('returns a placeholder object schema for missing or empty schemas', () => {
        assert.deepEqual(sanitizeSchema(null), PLACEHOLDER);
        assert.deepEqual(sanitizeSchema({ type: 'object', properties: {} }), PLACEHOLDER);
    });

    it('keeps only allow-listed keywords, recursively, including tuple items', () => {
        const result = sanitizeSchema({
            properties: {
                b: { type: 'array', items: [{ type: 'string', format: 'uri' }] },
                c: { type: 'array', items: { type: 'number', minimum: 1 } },
                d: { type: 'object', properties: { e: { type: 'string' } }, additionalProperties: false }
            },
            required: ['b']
        });
        assert.deepEqual(result, {
            type: 'object',
            properties: {
                b: { type: 'array', items: [{ type: 'string' }] },
                c: { type: 'array', items: { type: 'number' } },
                d: { type: 'object', properties: { e: { type: 'string' } } }
            },
            required: ['b']
        });
    });

    it('turns const into a typed single-value enum instead of a placeholder object', () => {
        assert.deepEqual(sanitizeSchema({ const: 'fixed' }), { type: 'string', enum: ['fixed'] });
        assert.deepEqual(sanitizeSchema({ const: 3 }), { type: 'number', enum: [3] });
        assert.deepEqual(sanitizeSchema({ enum: ['a', 'b'] }), { type: 'string', enum: ['a', 'b'] });
    });
});
