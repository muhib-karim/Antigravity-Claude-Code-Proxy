/**
 * Partial deep matching for fixture expectations.
 *
 * - Objects: every expected key must match; extra actual keys are ignored.
 * - Arrays: same length, element-wise match.
 * - Strings starting with "$" are matchers: "$string", "$number", "$present",
 *   "$regex:<pattern>", "$contains:<text>".
 */
import assert from 'node:assert/strict';

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [path]
 */
export function assertMatches(actual, expected, path = '$') {
    if (typeof expected === 'string' && expected.startsWith('$')) {
        const [kind, ...rest] = expected.split(':');
        const arg = rest.join(':');
        switch (kind) {
            case '$string':
                return assert.equal(typeof actual, 'string', `${path} should be a string`);
            case '$number':
                return assert.equal(typeof actual, 'number', `${path} should be a number`);
            case '$present':
                return assert.ok(actual !== undefined && actual !== null, `${path} should be present`);
            case '$regex':
                return assert.match(String(actual), new RegExp(arg), `${path}`);
            case '$contains':
                return assert.ok(
                    String(actual).includes(arg),
                    `${path} should contain ${JSON.stringify(arg)}, got ${JSON.stringify(actual)}`
                );
            default:
                break; // a literal string that happens to start with "$"
        }
    }
    if (Array.isArray(expected)) {
        assert.ok(Array.isArray(actual), `${path} should be an array, got ${JSON.stringify(actual)}`);
        assert.equal(actual.length, expected.length, `${path} length (actual ${JSON.stringify(actual)})`);
        expected.forEach((item, i) => assertMatches(actual[i], item, `${path}[${i}]`));
        return;
    }
    if (expected !== null && typeof expected === 'object') {
        assert.ok(
            actual !== null && typeof actual === 'object',
            `${path} should be an object, got ${JSON.stringify(actual)}`
        );
        for (const [key, value] of Object.entries(expected)) {
            assertMatches(actual[key], value, `${path}.${key}`);
        }
        return;
    }
    assert.deepEqual(actual, expected, path);
}

/**
 * Parse an SSE body into [{event, data}] (data JSON-decoded).
 * @param {string} text
 * @returns {Array<{event: string, data: any}>}
 */
export function parseSse(text) {
    return text
        .split('\n\n')
        .map(block => block.trim())
        .filter(Boolean)
        .map(block => {
            const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
            const data = /^data: (.*)$/m.exec(block)?.[1];
            return { event, data: data ? JSON.parse(data) : null };
        });
}
