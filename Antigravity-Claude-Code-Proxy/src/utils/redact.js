// @ts-check
/**
 * Secret redaction for logs and error messages.
 *
 * The proxy handles OAuth access/refresh tokens, API keys and client headers;
 * none of them may reach stdout, the log file or an HTTP error body.
 */

export const REDACTED = '[REDACTED]';

/** Object keys whose values are always secret (case-insensitive). */
const SENSITIVE_KEY = /token$|secret|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key/i;

export const URL_PLACEHOLDER = '[URL REDACTED]';

// "scheme://" (or "scheme:\\", which the URL parser treats alike for http(s)) and the authority
// candidate after it. Per the WHATWG URL parser the authority ends at the first "/", "?", "#" or
// "\" (or the end); whitespace also ends it here because it ends a URL in free text. Quotes and
// angle brackets do not: a malformed password may contain them. The match cannot backtrack, so
// the scan stays linear.
const URL_AUTHORITY = /\b([a-z][a-z0-9+.-]{0,30}:[/\\]{2,})([^\s/?#\\]*)/gi;

/**
 * @param {string} _match
 * @param {string} scheme - "scheme://"
 * @param {string} authority - Everything up to the end of the authority
 * @returns {string}
 */
function maskAuthority(_match, scheme, authority) {
    // The userinfo is everything up to the LAST "@" of the authority; "%40" is not a separator
    const at = authority.lastIndexOf('@');
    return at === -1 ? `${scheme}${authority}` : `${scheme}***@${authority.slice(at + 1)}`;
}

/**
 * Replace credentials embedded in URLs with "***" ("http://user:pass@host" -> "http://***@host").
 * An "@" in the path, query or fragment is left alone.
 * @param {string} text
 * @returns {string}
 */
export function redactUrlCredentials(text) {
    return text.replace(URL_AUTHORITY, maskAuthority);
}

/**
 * Redact a single URL value for display. The masked result is checked with the URL parser; if
 * the value cannot be parsed, or the parser still finds credentials that the text masking could
 * not delimit (e.g. "http:user:pass@host"), the whole value is replaced with URL_PLACEHOLDER.
 * @param {string} value
 * @returns {string}
 */
export function redactUrl(value) {
    if (!URL.canParse(value)) return URL_PLACEHOLDER;
    const masked = redactUrlCredentials(value);
    const parsed = URL.canParse(masked) ? new URL(masked) : null;
    if (!parsed || parsed.password || (parsed.username && parsed.username !== '***')) return URL_PLACEHOLDER;
    return masked;
}

/** @type {Array<[RegExp, string]>} */
const STRING_PATTERNS = [
    // "Authorization: Bearer <token>" and friends
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, `$1 ${REDACTED}`],
    // Google OAuth access tokens and refresh tokens
    [/\bya29\.[A-Za-z0-9._-]+/g, REDACTED],
    [/\b1\/\/[A-Za-z0-9._-]{8,}/g, REDACTED],
    // Google API keys
    [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
    // Anthropic / OpenAI style keys and Perplexity API keys
    [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
    [/\bpplx-[A-Za-z0-9_-]{16,}/g, REDACTED],
    // Google OAuth client secrets
    [/\bGOCSPX-[A-Za-z0-9_-]{10,}/g, REDACTED],
    // JWT / JWE values (e.g. next-auth session tokens): header.payload.signature
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]+/g, REDACTED],
    // Cookie pairs whose name marks a session or token: name=value. Name parts are bounded so
    // the scan stays linear; "tokens" is excluded so e.g. "max_tokens=200000" survives.
    [/\b([\w.-]{0,40}(?:session|token(?!s)|auth)[\w.-]{0,40}=)[^;\s"']{1,4096}/gi, `$1${REDACTED}`],
    // JSON fields with secret-looking names: "access_token":"..."
    [
        /"((?:access|refresh|id|session)?[-_]?token|accessToken|refreshToken|idToken|client[-_]?secret|clientSecret|api[-_]?key|apiKey|password|authorization|cookie)"\s*:\s*"[^"]*"/gi,
        `"$1":"${REDACTED}"`
    ],
    // Query-string secrets: ?access_token=...&key=...
    [/([?&](?:access_token|refresh_token|client_secret|api_key|key|token|code)=)[^&\s"']+/gi, `$1${REDACTED}`]
];

/**
 * Redact secrets that appear inside free text.
 * @param {string} text
 * @returns {string}
 */
export function redactString(text) {
    let out = redactUrlCredentials(text);
    for (const [pattern, replacement] of STRING_PATTERNS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

/**
 * Deep-copy a value with secrets removed: sensitive keys are masked and all
 * strings are scanned for token patterns. Never mutates the input.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {any}
 */
export function redact(value, seen = new WeakSet()) {
    if (typeof value === 'string') return redactString(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) {
        const copy = new Error(redactString(value.message));
        copy.name = value.name;
        if (value.stack) copy.stack = redactString(value.stack);
        return copy;
    }
    if (Array.isArray(value)) return value.map(item => redact(item, seen));

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen);
    }
    return out;
}

/**
 * Wrap console-like methods so every argument is redacted before printing.
 * @param {Record<string, any>} [target=console]
 * @returns {() => void} Restores the original methods
 */
export function installConsoleRedaction(target = console) {
    const methods = ['log', 'info', 'warn', 'error', 'debug'].filter(m => typeof target[m] === 'function');
    /** @type {Record<string, Function>} */
    const originals = {};
    for (const method of methods) {
        originals[method] = target[method];
        target[method] = (/** @type {unknown[]} */ ...args) =>
            originals[method].apply(
                target,
                args.map(a => redact(a))
            );
    }
    return () => {
        for (const method of methods) target[method] = originals[method];
    };
}
