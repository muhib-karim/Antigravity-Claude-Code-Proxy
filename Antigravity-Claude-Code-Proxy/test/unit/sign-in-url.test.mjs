/**
 * The Google sign-in URL is built from the non-secret SIGN_IN_* settings; it must carry
 * PKCE, a fresh CSRF state and the local callback, and never the client secret.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthorizationUrl } from '../../src/oauth.js';
import { SIGN_IN_CALLBACK_PORT, SIGN_IN_SCOPES, OAUTH_CONFIG } from '../../src/constants.js';

describe('getAuthorizationUrl', () => {
    it('builds a PKCE sign-in URL for the local callback', () => {
        const { url, verifier, state } = getAuthorizationUrl();
        const u = new URL(url);
        assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
        assert.equal(u.searchParams.get('redirect_uri'), `http://localhost:${SIGN_IN_CALLBACK_PORT}/oauth-callback`);
        assert.equal(u.searchParams.get('scope'), SIGN_IN_SCOPES.join(' '));
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(u.searchParams.get('state'), state);
        assert.match(state, /^[0-9a-f]{32}$/);
        assert.ok(u.searchParams.get('code_challenge') && verifier, 'PKCE challenge and verifier');
        assert.equal(u.searchParams.get('client_secret'), null);
        assert.equal(OAUTH_CONFIG.callbackPort, SIGN_IN_CALLBACK_PORT);
    });

    it('uses a fresh state and verifier per flow', () => {
        const a = getAuthorizationUrl();
        const b = getAuthorizationUrl();
        assert.notEqual(a.state, b.state);
        assert.notEqual(a.verifier, b.verifier);
    });
});
