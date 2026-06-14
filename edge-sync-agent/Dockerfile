# Build stage
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Production stage
FROM node:20-slim

LABEL maintainer="SmartFarm Edge Team"
LABEL description="SmartFarm Edge Sync Agent - IoT data sync for Raspberry Pi"

# Security: run as non-root
RUN groupadd -r agent && useradd -r -g agent -m -s /bin/false agent

WORKDIR /app

# Copy only production artifacts
COPY package.json package-lock.json* ./
RUN npm ci --production --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY config/ ./config/

# Create data directories with proper permissions
RUN mkdir -p data/logs data/ota && chown -R agent:agent /app

# Resource limits for RPi
ENV NODE_OPTIONS="--max-old-space-size=64 --gc-interval=100"
ENV NODE_ENV=production

USER agent

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

# Expose nothing — this is an outbound-only agent
EXPOSE []

ENTRYPOINT ["node", "dist/index.js"]
