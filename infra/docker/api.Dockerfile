FROM node:20-bookworm-slim

WORKDIR /app

COPY packages ./packages
COPY mcp_gpt_desk/package.json mcp_gpt_desk/package-lock.json ./mcp_gpt_desk/

WORKDIR /app/mcp_gpt_desk
RUN npm ci --omit=dev

COPY mcp_gpt_desk/src ./src
COPY mcp_gpt_desk/scripts ./scripts
COPY mcp_gpt_desk/contracts ./contracts

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787
CMD ["node", "src/server.js"]
