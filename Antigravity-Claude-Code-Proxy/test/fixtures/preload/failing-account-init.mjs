/**
 * Preload (node --import) that makes account initialisation fail, so tests can check how
 * /health and /readyz report a proxy whose account pool could not be loaded.
 */
import { AccountManager } from '../../../src/account-manager.js';

AccountManager.prototype.initialize = async function initialize() {
    throw new Error('account store could not be loaded (simulated)');
};
