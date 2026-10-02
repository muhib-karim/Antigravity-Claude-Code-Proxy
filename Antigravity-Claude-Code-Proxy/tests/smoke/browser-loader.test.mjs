// The headless-browser packages are optional peers: a default install must not
// pull them in, and the Perplexity browser path must fail with a clear hint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { loadBrowser, BROWSER_INSTALL_HINT } from '../../src/browser-loader.js';

const require = createRequire(import.meta.url);
const installed = (() => {
    try {
        require.resolve('puppeteer-extra');
        return true;
    } catch {
        return false;
    }
})();

test('core server modules import without the browser packages', async () => {
    const server = await import('../../src/server.js');
    assert.ok(server);
});

test('loadBrowser explains how to install the optional packages', { skip: installed }, async () => {
    await assert.rejects(loadBrowser(), (error) => {
        assert.equal(error.message, BROWSER_INSTALL_HINT);
        assert.match(error.message, /npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth/);
        return true;
    });
});
