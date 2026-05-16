FROM node:22-alpine AS builder
WORKDIR /app

# Bun is used only for the one-shot region dump performed at image
# build time. The runtime image runs on Node only.
RUN apk add --no-cache curl bash \
 && curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun

COPY services/bot-sreality/package*.json ./
RUN npm ci

# Pinned Sreality region catalogue: the dump layer's cache key is just
# the dump script + package files, so source edits do not invalidate
# the multi-minute network sweep on every rebuild. Refresh = force
# rebuild without cache (e.g. `docker build --no-cache`).
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
