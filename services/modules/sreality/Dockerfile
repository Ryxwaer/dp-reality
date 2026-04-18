FROM node:22-alpine AS builder
WORKDIR /app
COPY services/modules/sreality/package*.json ./
RUN npm ci
COPY services/modules/sreality/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY proto/bot_module.proto /proto/bot_module.proto
CMD ["node", "dist/main.js"]
