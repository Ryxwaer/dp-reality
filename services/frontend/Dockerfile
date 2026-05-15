# Two-stage build: bun does the install + Nuxt build (a lot faster than
# npm/pnpm on multi-arch CI), node runs the resulting Nitro output. The
# runtime layer stays node:22-alpine to keep the surface area identical
# to the rest of the cluster's Node images and to keep the production
# image small — bun's runtime is not needed once .output is built.
FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY services/frontend/ ./
RUN bun install --frozen-lockfile
RUN bun run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
