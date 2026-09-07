FROM node:22-bookworm-slim

WORKDIR /app

COPY packages ./packages
COPY config/prompt-registry ./config/prompt-registry
COPY docs/CHATGPT_LIVE_WORKER_PROMPT.md ./docs/CHATGPT_LIVE_WORKER_PROMPT.md
COPY docs/CHATGPT_REPLAY_WORKER_PROMPT.md ./docs/CHATGPT_REPLAY_WORKER_PROMPT.md
COPY mcp_gpt_desk/package.json mcp_gpt_desk/package-lock.json ./mcp_gpt_desk/

WORKDIR /app/mcp_gpt_desk
RUN npm ci --omit=dev
RUN ln -s /app/mcp_gpt_desk/node_modules /app/node_modules

COPY mcp_gpt_desk/src ./src
COPY mcp_gpt_desk/scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787
CMD ["node", "src/server.js"]
