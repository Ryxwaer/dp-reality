FROM node:22-alpine AS builder

WORKDIR /app

COPY services/frontend/package*.json ./
RUN npm ci

COPY services/frontend/ .
COPY proto/ /proto/
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output
COPY proto/ /proto/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
