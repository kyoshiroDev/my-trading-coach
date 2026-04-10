FROM node:22-slim AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build api-mytradingcoach --configuration=production

FROM node:22-alpine AS migrator
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm dlx prisma generate

FROM node:22-alpine AS runtime
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nestjs
WORKDIR /app
COPY --from=builder /app/apps/api-mytradingcoach/dist ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
USER nestjs
EXPOSE 3000
CMD ["sh", "-c", "node main.js"]
