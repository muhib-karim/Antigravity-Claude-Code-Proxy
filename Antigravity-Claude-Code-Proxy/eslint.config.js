import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                // perplexity-browser-*.js run callbacks inside the page via puppeteer's page.evaluate()
                ...globals.browser
            }
        },
        rules: {
            'no-unused-vars': 'error',
            'no-empty': 'error'
        }
    },
    {
        files: ['test/**/*.mjs', 'tests/smoke/**/*.mjs', 'scripts/**/*.js', 'bin/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node }
    },
    {
        files: ['src/public/**/*.js'],
        languageOptions: { globals: globals.browser }
    }
];
