FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build api-mytradingcoach --configuration=production

FROM node:22-alpine AS migrator
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm dlx prisma generate

FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nestjs -G nodejs
WORKDIR /app
COPY --from=builder /app/apps/api-mytradingcoach/dist ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs apps/api-mytradingcoach/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
USER nestjs
EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
