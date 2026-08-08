# ---- Stage 1: build del frontend Angular ----
FROM node:20 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: install dipendenze server (better-sqlite3 richiede compilazione nativa) ----
FROM node:20-slim AS server-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Stage 3: immagine finale ----
FROM node:20-slim
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server/ ./server/
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./public

EXPOSE 3000
CMD ["node", "server/server.js"]
