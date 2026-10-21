// @ts-check
/**
 * Helmet-style security headers, kept dependency-free. The dashboard is a single HTML page
 * with inline script/styles and Google Fonts, and may be embedded by the VS Code extension's
 * webview, so it gets its own CSP; every other (JSON/SSE) response is locked down.
 */

export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const DASHBOARD_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self' vscode-webview: vscode-file:"
].join('; ');

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard.html']);

/**
 * @param {{path: string}} req
 * @param {{setHeader: (name: string, value: string) => void, removeHeader: (name: string) => void}} res
 * @param {() => void} next
 */
export function securityHeaders(req, res, next) {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Origin-Agent-Cluster', '?1');
    if (DASHBOARD_PATHS.has(req.path)) {
        res.setHeader('Content-Security-Policy', DASHBOARD_CSP);
    } else {
        res.setHeader('Content-Security-Policy', API_CSP);
        res.setHeader('X-Frame-Options', 'DENY');
    }
    next();
}
