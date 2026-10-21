// @ts-check
/**
 * Side-effect module: redact console output process-wide. Imported first by src/index.js
 * so that it runs before any other module is evaluated (ES modules evaluate imports in
 * order), which means even messages logged while modules load are covered.
 */
import { installConsoleRedaction } from './redact.js';

installConsoleRedaction();
