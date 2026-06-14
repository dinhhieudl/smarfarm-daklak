# SmartFarm Cloud API - Production Dockerfile
# Multi-stage build for minimal image size

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 smartfarm && \
    adduser -u 1001 -G smartfarm -s /bin/sh -D smartfarm

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Health check
RUN apk add --no-cache wget
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

USER smartfarm
EXPOSE 3000
CMD ["node", "dist/index.js"]
