#!/usr/bin/env node

import { getAuthorizationUrl } from '../../Antigravity-Claude-Code-Proxy/src/oauth.js';

const { url, verifier, state } = getAuthorizationUrl();

console.log('\n╔════════════════════════════════════════╗');
console.log('║     AntiGravity Account Login Link     ║');
console.log('╚════════════════════════════════════════╝\n');

console.log('🔗 COPY THIS LINK AND OPEN IN YOUR BROWSER:\n');
console.log(url);
console.log('\n📋 INSTRUCTIONS:');
console.log('1. Click the link above (or copy-paste into browser)');
console.log('2. Sign in with a DIFFERENT Google account');
console.log('3. Grant permissions when prompted');
console.log('4. Close the browser after authentication');
console.log('5. Return to terminal and press Enter to continue\n');

console.log('⚠️  IMPORTANT: Use a DIFFERENT Google account than the ones already added');
console.log('⚠️  You must CLOSE the browser after granting permissions\n');