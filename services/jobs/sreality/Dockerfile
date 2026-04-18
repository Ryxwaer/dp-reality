FROM node:22-alpine AS builder
WORKDIR /app
COPY services/jobs/sreality/package*.json ./
RUN npm ci
COPY services/jobs/sreality/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]
