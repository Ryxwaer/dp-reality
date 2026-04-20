FROM node:22-alpine AS builder

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY services/frontend/ ./
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
