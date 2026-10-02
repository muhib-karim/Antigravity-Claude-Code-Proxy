# AGENTS.md

Antigravity Claude Proxy - Node.js proxy for using Gemini/Claude models with Claude Code CLI.

## Commands

```bash
# Install & Run
npm install                    # Install dependencies
npm start                      # Start server (port 8080)
npm run dev                    # Watch mode development

# Account Management
npm run accounts               # Interactive account management
npm run accounts:add           # Add new Google account via OAuth
npm run accounts:list          # List configured accounts
npm run accounts:verify        # Verify account tokens

# Offline tests (mock upstream, no server or accounts needed)
npm test
npm run lint

# Live tests (server must be running with a real account)
npm run test:live              # All live tests
npm run test:signatures        # Thinking signatures
npm run test:multiturn         # Multi-turn with tools
npm run test:streaming         # Streaming SSE events
npm run test:interleaved       # Interleaved thinking
npm run test:images            # Image processing
npm run test:caching           # Prompt caching

# Code Quality
npm run lint                   # ESLint check
npm run format                 # Prettier format
```

## Architecture

**Entry Point:** `src/index.js` → Express server (`src/server.js`)

**Request Flow:** Claude CLI → Express Server → CloudCode Client → Antigravity Cloud Code API

**Core Modules:**
- `server.js` - Anthropic-compatible REST API (`/v1/messages`, `/v1/models`, etc.)
- `cloudcode-client.js` - Upstream API client with retry/failover logic
- `account-manager.js` - Multi-account load balancing with sticky session for caching
- `format/` - Anthropic ↔ Google Generative AI format converters (request, response, content, thinking blocks, schema validation)
- `constants.js` - Centralized config (API endpoints, model mappings, OAuth settings, rate limits)
- `errors.js` - Custom error classes (`RateLimitError`, `AuthError`, `ApiError`, etc.)
- `token-extractor.js` - Token management from local Antigravity installation

**Testing:** Tests are in `tests/` as CommonJS (`.cjs`) making HTTP requests to local proxy. Shared utilities in `tests/helpers/http-client.cjs`.

## Code Style

**Imports:** ES6 modules (`import`/`export`)  
**Functions:** JSDoc comments required (parameters, return types). Custom errors for structured error handling.  
**Constants:** All config values in `src/constants.js` (use `getModelFamily()`, `isThinkingModel()` for model detection)  
**Error Handling:** Use custom error classes (not string-based). Helper functions: `isRateLimitError()`, `isAuthError()`  
**Utilities:** Shared helpers in `src/utils/helpers.js` (`formatDuration`, `sleep`)

**See CLAUDE.md for full architecture details, model handling, and multi-account logic.**
