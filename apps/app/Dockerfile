# Stage 1: Base runtime environment
FROM oven/bun:1.3.14-alpine AS base

RUN apk add --no-cache openssl postgresql-client

WORKDIR /app

# Stage 2: Install dependencies
FROM base AS installer

COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/app/package.json ./apps/app/
COPY packages/agent/package.json ./packages/agent/
COPY packages/github/package.json ./packages/github/
COPY packages/sdk/package.json ./packages/sdk/
COPY patches ./patches
RUN bun install --ignore-scripts

FROM node:24-alpine AS node_source

# Stage 3: Build the application
FROM installer AS builder
COPY . .
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV BETTER_AUTH_SECRET=placeholder_secret_for_build_only
RUN bunx turbo run build

# Stage 4: Production runtime
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3555
WORKDIR /app

COPY --from=builder /app/apps/app/.output ./.output


EXPOSE 3555

CMD ["bun", "./.output/server/index.mjs"]