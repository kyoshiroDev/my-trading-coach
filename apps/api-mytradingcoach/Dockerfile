# Stage 1 — Build NestJS
FROM node:22-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY nx.json tsconfig*.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/api-mytradingcoach ./apps/api-mytradingcoach
COPY prisma ./prisma

RUN pnpm nx build api-mytradingcoach --configuration=production

# Stage 2 — Générer client Prisma + installer prod deps
FROM node:22-alpine AS deps
RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
RUN pnpm exec prisma generate --config=./prisma/prisma.config.ts 2>/dev/null || true

# Stage 3 — Runtime minimal
FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/api-mytradingcoach ./
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nestjs:nodejs /app/prisma ./prisma

USER nestjs
EXPOSE 3000

# Applique les migrations puis démarre
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --config=./prisma/prisma.config.ts && node main.js"]
