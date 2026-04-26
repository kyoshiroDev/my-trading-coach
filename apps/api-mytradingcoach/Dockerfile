FROM node:22-slim AS builder
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN NX_DAEMON=false NX_NO_CLOUD=true pnpm nx build api-mytradingcoach --configuration=production --skip-nx-cache

FROM node:22-alpine AS migrator
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm exec prisma generate --config=./prisma/prisma.config.ts

FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nestjs -G nodejs
WORKDIR /app
COPY --from=builder /app/apps/api-mytradingcoach/dist ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
# Dépendances api-spécifiques (helmet, ioredis, argon2…) hoisté dans le workspace package
COPY --from=migrator --chown=nestjs:nodejs /app/apps/api-mytradingcoach/node_modules ./apps/api-mytradingcoach/node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs apps/api-mytradingcoach/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# NODE_PATH permet à Node.js de résoudre les deps api depuis apps/api-mytradingcoach/node_modules
ENV NODE_PATH=/app/apps/api-mytradingcoach/node_modules
USER nestjs
EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
