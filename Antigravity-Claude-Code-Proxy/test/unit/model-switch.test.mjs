/**
 * Natural-language model switching ("switch to pro", "/model flash") runs regexes over
 * user-controlled prompt text, so they must be correct and linear-time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectModelSwitch } from '../../src/http/model-switch.js';

describe('detectModelSwitch', () => {
    it('extracts the requested model from common phrasings', () => {
        const cases = {
            '/model thinking': 'thinking',
            '/model gemini-3-pro-high': 'gemini-3-pro-high',
            'switch to grok': 'grok',
            'please use the pro model': 'pro',
            'change model to flash': 'flash',
            'set to model opus': 'opus',
            'Switch To Sonnet now': 'sonnet',
            'model kimi': 'kimi'
        };
        for (const [text, expected] of Object.entries(cases)) {
            assert.equal(detectModelSwitch(text), expected, text);
        }
    });

    it('returns null when no switch is requested', () => {
        assert.equal(detectModelSwitch('Write a haiku about the sea'), null);
        assert.equal(detectModelSwitch(''), null);
        assert.equal(detectModelSwitch(undefined), null);
    });

    it('runs in linear time on adversarial whitespace and word runs', () => {
        const inputs = [
            'switch' + ' '.repeat(50_000) + '!',
            'use ' + 'to '.repeat(20_000) + '!',
            'model ' + 'a-'.repeat(30_000) + '!',
            '/model ' + '\t'.repeat(50_000)
        ];
        for (const text of inputs) {
            const started = process.hrtime.bigint();
            detectModelSwitch(text);
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            assert.ok(ms < 200, `took ${ms.toFixed(1)}ms`);
        }
    });
});
