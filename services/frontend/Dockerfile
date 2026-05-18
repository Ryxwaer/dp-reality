FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY services/frontend/ ./
RUN bun install --frozen-lockfile
RUN bun run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/otel-init.mjs ./.output/server/otel-init.mjs

ENV NODE_ENV=production
ENV NODE_OPTIONS=--import=file:///app/.output/server/otel-init.mjs
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
