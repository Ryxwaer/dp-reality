FROM node:22-alpine AS builder
WORKDIR /app
COPY services/bot-sreality/package*.json ./
RUN npm ci
COPY services/bot-sreality/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8000
CMD ["node", "dist/main.js"]
