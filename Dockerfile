FROM us-docker.pkg.dev/hasura-container-images/external-images/docker.io/library/node:20-alpine-stable

# Set production environment
ENV NODE_ENV=production

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

CMD ["node", "index.js"]
