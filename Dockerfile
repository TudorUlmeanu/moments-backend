# ---- base deps (with dev deps for building) ----
FROM node:20-alpine AS deps
WORKDIR /app
# Install build tools needed by some packages (optional)
RUN apk add --no-cache python3 make g++ git
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build (compile TS) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* tsconfig.json ./
COPY src ./src
# templates are runtime assets, copy now so we can test in image layers
COPY templates ./templates
RUN npm run build

# ---- prod deps (omit dev) ----
FROM node:20-alpine AS proddeps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# non-root user
RUN addgroup -S app && adduser -S app -G app

# copy compiled app + prod deps + templates
COPY --from=build /app/dist ./dist
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/templates ./templates
COPY package.json ./

# optional: healthcheck (your server has GET /health)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

EXPOSE 8080
USER app
CMD ["node", "dist/server.js"]
