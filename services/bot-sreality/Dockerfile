FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache curl bash \
 && curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

COPY services/bot-sreality/package*.json ./
RUN npm ci

COPY services/bot-sreality/scripts ./scripts
RUN bun run dump:regions

COPY services/bot-sreality/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/data ./data
EXPOSE 8000
CMD ["node", "dist/main.js"]
