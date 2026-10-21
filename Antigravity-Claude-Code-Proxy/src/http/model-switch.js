// @ts-check
/**
 * Detect natural-language model switch requests in the last user message, e.g.
 * "/model thinking", "switch to grok", "use the pro model", "change model to flash".
 *
 * The text is user-controlled, so every pattern is unambiguous (no adjacent
 * quantifiers that can match the same characters) and runs in linear time.
 */

const SWITCH_PATTERNS = [
    // Explicit command: "/model thinking"
    /^\/model\s+(\w[-\w]*)/i,
    // "switch to X", "use the X model", "change model to X", "set to model X"
    /(?:switch|change|use|set)\s+(?:(?:to|the)\s+)?(?:model\s+)?(?:to\s+)?(\w[-\w]*)/i,
    // "model X", "switch X"
    /(?:model|switch)\s+(?:to\s+)?(\w[-\w]*)/i
];

/**
 * @param {string | undefined | null} text - Last user message text
 * @returns {string | null} Requested model word (lower-cased) or null
 */
export function detectModelSwitch(text) {
    if (!text) return null;
    for (const pattern of SWITCH_PATTERNS) {
        const match = pattern.exec(text);
        if (match && match[1]) return match[1].toLowerCase();
    }
    return null;
}
