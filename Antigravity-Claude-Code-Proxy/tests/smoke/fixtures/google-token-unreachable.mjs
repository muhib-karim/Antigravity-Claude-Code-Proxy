/**
 * Preloaded into the proxy (node --import) to simulate a network failure
 * when refreshing OAuth tokens; every other request goes through untouched.
 */
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (String(url).startsWith('https://oauth2.googleapis.com/')) {
        return Promise.reject(new TypeError('fetch failed'));
    }
    return realFetch(input, init);
};
