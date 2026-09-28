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
            // Existing code has many unused variables/empty catches; report them without failing the build
            'no-unused-vars': 'warn',
            'no-empty': 'warn'
        }
    },
    {
        files: ['src/public/**/*.js'],
        languageOptions: { globals: globals.browser }
    }
];
