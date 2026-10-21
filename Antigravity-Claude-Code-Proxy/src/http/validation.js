// @ts-check
/**
 * Validation of incoming Anthropic Messages API requests and of the routing headers
 * the proxy honours. Problems are returned as human-readable lines so the client
 * gets one clear 400 listing everything that is wrong.
 */

const MAX_PROBLEMS = 10;
const TOOL_CHOICE_TYPES = ['auto', 'any', 'tool', 'none'];
const THINKING_TYPES = ['enabled', 'disabled', 'adaptive'];

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isNonEmptyString(v) {
    return typeof v === 'string' && v.length > 0;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPositiveInt(v) {
    return Number.isInteger(v) && /** @type {number} */ (v) > 0;
}

/**
 * @param {unknown} v
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function inRange(v, min, max) {
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * @param {Record<string, any>} block
 * @param {string} path
 * @param {string[]} problems
 */
function checkBlock(block, path, problems) {
    if (!isObject(block)) {
        problems.push(`${path}: must be an object`);
        return;
    }
    if (typeof block.type !== 'string') {
        problems.push(`${path}.type: must be a string`);
        return;
    }
    if (block.type === 'text' && typeof block.text !== 'string') {
        problems.push(`${path}.text: must be a string`);
    }
    if (block.type === 'tool_use') {
        if (!isNonEmptyString(block.id)) problems.push(`${path}.id: must be a non-empty string`);
        if (!isNonEmptyString(block.name)) problems.push(`${path}.name: must be a non-empty string`);
        if (!isObject(block.input)) problems.push(`${path}.input: must be an object`);
    }
    if (block.type === 'tool_result' && !isNonEmptyString(block.tool_use_id)) {
        problems.push(`${path}.tool_use_id: must be a non-empty string`);
    }
}

/**
 * @param {unknown} messages
 * @param {string[]} problems
 */
function checkMessages(messages, problems) {
    if (!Array.isArray(messages)) {
        problems.push('messages: is required and must be an array');
        return;
    }
    if (messages.length === 0) {
        problems.push('messages: must not be empty');
        return;
    }
    messages.forEach((msg, i) => {
        const path = `messages[${i}]`;
        if (!isObject(msg)) {
            problems.push(`${path}: must be an object`);
            return;
        }
        if (msg.role !== 'user' && msg.role !== 'assistant') {
            problems.push(`${path}.role: must be "user" or "assistant"`);
        }
        if (typeof msg.content === 'string') return;
        if (!Array.isArray(msg.content)) {
            problems.push(`${path}.content: must be a string or an array of content blocks`);
            return;
        }
        msg.content.forEach((block, j) => checkBlock(block, `${path}.content[${j}]`, problems));
    });
}

/**
 * @param {Record<string, any>} body
 * @param {string[]} problems
 */
function checkTools(body, problems) {
    if (body.tools !== undefined) {
        if (!Array.isArray(body.tools)) {
            problems.push('tools: must be an array');
        } else {
            body.tools.forEach((tool, i) => {
                if (!isObject(tool) || !isNonEmptyString(tool.name)) {
                    problems.push(`tools[${i}].name: must be a non-empty string`);
                } else if (tool.input_schema !== undefined && !isObject(tool.input_schema)) {
                    problems.push(`tools[${i}].input_schema: must be an object`);
                }
            });
        }
    }
    if (body.tool_choice !== undefined) {
        const choice = body.tool_choice;
        if (!isObject(choice) || !TOOL_CHOICE_TYPES.includes(choice.type)) {
            problems.push(`tool_choice.type: must be one of ${TOOL_CHOICE_TYPES.join(', ')}`);
        } else if (choice.type === 'tool' && !isNonEmptyString(choice.name)) {
            problems.push('tool_choice.name: is required when tool_choice.type is "tool"');
        }
    }
}

/**
 * Validate a POST /v1/messages body.
 * @param {unknown} body - Parsed JSON body
 * @returns {string[]} Problems; empty when the request is valid
 */
export function validateMessagesRequest(body) {
    if (!isObject(body)) return ['body: must be a JSON object'];
    /** @type {string[]} */
    const problems = [];

    if (body.model !== undefined && !isNonEmptyString(body.model)) problems.push('model: must be a non-empty string');
    checkMessages(body.messages, problems);
    if (body.max_tokens !== undefined && !isPositiveInt(body.max_tokens)) {
        problems.push('max_tokens: must be a positive integer');
    }
    if (body.stream !== undefined && typeof body.stream !== 'boolean') problems.push('stream: must be a boolean');
    if (body.system !== undefined && typeof body.system !== 'string') {
        const ok =
            Array.isArray(body.system) &&
            body.system.every(b => isObject(b) && b.type === 'text' && typeof b.text === 'string');
        if (!ok) problems.push('system: must be a string or an array of text blocks');
    }
    if (body.temperature !== undefined && !inRange(body.temperature, 0, 1)) {
        problems.push('temperature: must be a number between 0 and 1');
    }
    if (body.top_p !== undefined && !inRange(body.top_p, 0, 1))
        problems.push('top_p: must be a number between 0 and 1');
    if (body.top_k !== undefined && !(Number.isInteger(body.top_k) && body.top_k >= 0)) {
        problems.push('top_k: must be a non-negative integer');
    }
    if (
        body.stop_sequences !== undefined &&
        !(Array.isArray(body.stop_sequences) && body.stop_sequences.every(s => typeof s === 'string'))
    ) {
        problems.push('stop_sequences: must be an array of strings');
    }
    if (body.metadata !== undefined && !isObject(body.metadata)) problems.push('metadata: must be an object');
    checkTools(body, problems);
    if (body.thinking !== undefined) {
        const thinking = body.thinking;
        if (!isObject(thinking) || !THINKING_TYPES.includes(thinking.type)) {
            problems.push(`thinking.type: must be one of ${THINKING_TYPES.join(', ')}`);
        } else if (thinking.type === 'enabled' && !isPositiveInt(thinking.budget_tokens)) {
            problems.push('thinking.budget_tokens: must be a positive integer when thinking is enabled');
        }
    }

    if (problems.length > MAX_PROBLEMS) {
        const extra = problems.length - MAX_PROBLEMS;
        return [...problems.slice(0, MAX_PROBLEMS), `...and ${extra} more problems`];
    }
    return problems;
}

const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

/**
 * 1-256 characters with no ASCII control characters.
 * @param {unknown} v
 * @returns {boolean}
 */
function isPrintableId(v) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 256) return false;
    for (let i = 0; i < v.length; i++) {
        const code = v.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
}

/**
 * Allow-list check for the client headers that influence routing. Session IDs are
 * free-form (bin/claude-session.sh derives them from the folder path) but bounded;
 * model overrides must look like a model id.
 * @param {Record<string, string | string[] | undefined>} headers - Lower-cased request headers
 * @returns {string[]} Problems; empty when acceptable
 */
export function validateRoutingHeaders(headers) {
    /** @type {string[]} */
    const problems = [];
    const sessionId = headers['x-session-id'];
    if (sessionId !== undefined && !isPrintableId(sessionId)) {
        problems.push('x-session-id: must be 1-256 printable characters');
    }
    const override = headers['x-override-model'];
    if (override !== undefined && !(typeof override === 'string' && MODEL_PATTERN.test(override))) {
        problems.push('x-override-model: must be 1-128 characters of letters, digits, ".", "_", ":", "/" or "-"');
    }
    return problems;
}
