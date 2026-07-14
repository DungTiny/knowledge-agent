# Stage 1: Base runtime environment
FROM oven/bun:1-alpine AS base

# Install system dependencies (openssl for Better Auth, postgresql-client for pg_isready)
RUN apk add --no-cache openssl postgresql-client

WORKDIR /app

# Stage 2: Install dependencies to leverage caching
FROM base AS installer
# Copy workspace package definitions
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/app/package.json ./apps/app/
COPY packages/agent/package.json ./packages/agent/
COPY packages/github/package.json ./packages/github/
COPY packages/sdk/package.json ./packages/sdk/

# Copy patches
COPY patches ./patches

# Install dependencies
RUN bun install --ignore-scripts

# Stage 3: Build the application
FROM installer AS builder
# Install Node.js and npm for stable build compilation with memory limits
RUN apk add --no-cache nodejs npm

# Copy the rest of the application source code
COPY . .

# Set build-time environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV BETTER_AUTH_SECRET=placeholder_secret_for_build_only

# Build the project using Node.js/Turbo (which respects NODE_OPTIONS heap memory limits)
RUN npx turbo run build

# Stage 4: Production runtime
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3555
WORKDIR /app

# Chỉ copy build output của app, không copy cả /app (giảm size, tránh leak source thừa)
COPY --from=builder /app/apps/app/.output ./.output

EXPOSE 3555

CMD ["bun", "./.output/server/index.mjs"]