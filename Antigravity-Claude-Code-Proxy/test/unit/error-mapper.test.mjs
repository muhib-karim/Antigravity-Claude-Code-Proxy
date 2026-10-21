/**
 * Unit tests for mapping internal/upstream errors to Anthropic API error responses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapError, parseDurationMs } from '../../src/http/error-mapper.js';
import { ApiError, RateLimitError, AuthError, TimeoutError, RequestValidationError } from '../../src/errors.js';

describe('mapError', () => {
    it('maps body-parser parse failures to 400 invalid_request_error', () => {
        const err = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 });
        assert.deepEqual(mapError(err), {
            status: 400,
            type: 'invalid_request_error',
            message: 'Request body is not valid JSON',
            retryAfterSeconds: null
        });
    });

    it('maps oversized bodies to 413 request_too_large', () => {
        const err = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', status: 413 });
        const mapped = mapError(err);
        assert.equal(mapped.status, 413);
        assert.equal(mapped.type, 'request_too_large');
    });

    it('maps validation errors to 400 with every problem listed', () => {
        const mapped = mapError(new RequestValidationError(['messages: required', 'max_tokens: must be > 0']));
        assert.equal(mapped.status, 400);
        assert.equal(mapped.type, 'invalid_request_error');
        assert.equal(mapped.message, 'messages: required; max_tokens: must be > 0');
    });

    it('maps upstream timeouts to 504 timeout_error', () => {
        const mapped = mapError(new TimeoutError(1500));
        assert.equal(mapped.status, 504);
        assert.equal(mapped.type, 'timeout_error');
        assert.match(mapped.message, /1500ms/);
    });

    it('maps quota exhaustion to 400 by default and carries retry-after', () => {
        const err = new Error('RESOURCE_EXHAUSTED: Rate limited. Quota will reset after 1h2m3s. Next available: x');
        const mapped = mapError(err);
        assert.equal(mapped.status, 400);
        assert.equal(mapped.type, 'invalid_request_error');
        assert.match(mapped.message, /Quota will reset after 1h2m3s/);
        assert.equal(mapped.retryAfterSeconds, 3723);
    });

    it('maps rate limits to 429 rate_limit_error when configured', () => {
        const mapped = mapError(new RateLimitError('Rate limited', 4200), { rateLimitStatus: 429 });
        assert.equal(mapped.status, 429);
        assert.equal(mapped.type, 'rate_limit_error');
        assert.equal(mapped.retryAfterSeconds, 5);
    });

    it('maps an upstream 429 ApiError with retry-after', () => {
        const mapped = mapError(new ApiError('API error 429: slow down', 429, 'api_error', 2000), {
            rateLimitStatus: 429
        });
        assert.equal(mapped.status, 429);
        assert.equal(mapped.retryAfterSeconds, 2);
    });

    it('maps authentication failures to 401', () => {
        assert.equal(mapError(new ApiError('API error 401: UNAUTHENTICATED', 401)).status, 401);
        assert.equal(mapError(new AuthError('Token refresh failed')).type, 'authentication_error');
    });

    it('trusts the upstream status over numbers that appear in the message text', () => {
        const mapped = mapError(new ApiError('API error 400: field limit is 401 characters', 400));
        assert.equal(mapped.status, 400);
        assert.equal(mapped.type, 'invalid_request_error');
        assert.equal(
            mapError(new ApiError('API error 400: retry 429 times is not allowed', 400), { rateLimitStatus: 429 })
                .status,
            400
        );
    });

    it('maps upstream 400 INVALID_ARGUMENT and extracts its message', () => {
        const body = JSON.stringify({ error: { code: 400, message: 'Invalid schema', status: 'INVALID_ARGUMENT' } });
        const mapped = mapError(new ApiError(`API error 400: ${body}`, 400));
        assert.equal(mapped.status, 400);
        assert.equal(mapped.type, 'invalid_request_error');
        assert.equal(mapped.message, 'Invalid schema');
    });

    it('maps upstream 403 and 404', () => {
        assert.equal(mapError(new ApiError('API error 403: PERMISSION_DENIED', 403)).type, 'permission_error');
        const nf = mapError(new ApiError('API error 404: model not found', 404));
        assert.equal(nf.status, 404);
        assert.equal(nf.type, 'not_found_error');
    });

    it('maps upstream 503/529 to 529 overloaded_error and other 5xx to 502', () => {
        const overloaded = mapError(new ApiError('API error 503: unavailable', 503, 'api_error', 3000));
        assert.equal(overloaded.status, 529);
        assert.equal(overloaded.type, 'overloaded_error');
        assert.equal(overloaded.retryAfterSeconds, 3);
        const bad = mapError(new ApiError('API error 500: internal', 500));
        assert.equal(bad.status, 502);
        assert.equal(bad.type, 'api_error');
    });

    it('maps unreachable upstreams to 503', () => {
        assert.equal(mapError(new Error('fetch failed')).status, 503);
        assert.equal(mapError(new Error('All endpoints failed')).status, 503);
    });

    it('keeps legacy string-based mapping for PERMISSION_DENIED', () => {
        assert.equal(mapError(new Error('PERMISSION_DENIED for project')).status, 403);
    });

    it('falls back to 500 api_error and redacts secrets from the message', () => {
        const mapped = mapError(new Error('boom with Bearer ya29.secretvalue123'));
        assert.equal(mapped.status, 500);
        assert.equal(mapped.type, 'api_error');
        assert.ok(!mapped.message.includes('ya29.secretvalue123'), mapped.message);
    });

    it('tolerates non-Error throwables', () => {
        assert.equal(mapError('weird').status, 500);
        assert.equal(mapError(undefined).status, 500);
    });
});

describe('parseDurationMs', () => {
    it('parses formatDuration output', () => {
        assert.equal(parseDurationMs('1h2m3s'), 3_723_000);
        assert.equal(parseDurationMs('5m0s'), 300_000);
        assert.equal(parseDurationMs('42s'), 42_000);
    });
    it('returns null for anything else', () => {
        assert.equal(parseDurationMs('soon'), null);
        assert.equal(parseDurationMs(''), null);
    });
});
