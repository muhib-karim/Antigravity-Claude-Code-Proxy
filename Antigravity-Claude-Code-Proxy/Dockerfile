# syntax=docker/dockerfile:1.7
# Multi-stage image for the proxy. Built in CI (.github/workflows/ci.yml, job "docker").
#
#   docker build -t antigravity-claude-code-proxy .
#   docker run --rm -p 127.0.0.1:8080:8080 -v agp-data:/data antigravity-claude-code-proxy

ARG NODE_VERSION=22

# ---- deps: install production dependencies (better-sqlite3 may compile from source) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    npm_config_fund=false \
    npm_config_audit=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Optional peer dependencies (Puppeteer, for Perplexity browser login) are not installed
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: no build tools, code owned by root, process runs as the unprivileged "node" user ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="antigravity-claude-code-proxy" \
      org.opencontainers.image.description="Anthropic Messages API gateway for Claude Code backed by Google Cloud Code" \
      org.opencontainers.image.source="https://github.com/muhib-karim/Antigravity-Claude-Code-Proxy" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    PROXY_STATE_DIR=/data \
    ACCOUNT_CONFIG_PATH=/data/accounts.json

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY bin ./bin
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/livez').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# node is PID 1 and handles SIGTERM itself: in-flight streams drain, then it exits 0
CMD ["node", "src/index.js"]
