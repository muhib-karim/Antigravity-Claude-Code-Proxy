/**
 * Lazy loader for the optional headless-browser stack used only by the
 * Perplexity browser login and browser client. The core gateway (Claude Code
 * -> Google models) never needs a browser, so these packages are optional
 * peer dependencies and are imported on first use.
 */

const BROWSER_PACKAGES = ['puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth'];

let loading = null;

export const BROWSER_INSTALL_HINT =
    `Perplexity browser features need the optional browser packages. Install them with: npm install ${BROWSER_PACKAGES.join(' ')}`;

/**
 * Import puppeteer-extra with the stealth plugin registered.
 * @returns {Promise<import('puppeteer-extra').PuppeteerExtra>}
 */
export async function loadBrowser() {
    if (!loading) {
        loading = (async () => {
            try {
                const { default: puppeteer } = await import('puppeteer-extra');
                const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
                puppeteer.use(StealthPlugin());
                return puppeteer;
            } catch (error) {
                loading = null;
                if (error && error.code === 'ERR_MODULE_NOT_FOUND') {
                    throw new Error(BROWSER_INSTALL_HINT, { cause: error });
                }
                throw error;
            }
        })();
    }
    return loading;
}
