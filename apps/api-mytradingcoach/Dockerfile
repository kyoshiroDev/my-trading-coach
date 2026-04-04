FROM node:22-alpine AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build api-mytradingcoach --configuration=production

FROM node:22-alpine AS migrator
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY prisma ./prisma
RUN pnpm dlx prisma generate

FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
WORKDIR /app
COPY --from=builder --chown=nestjs:nodejs /app/dist/apps/api-mytradingcoach ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
USER nestjs
EXPOSE 3000
CMD ["sh", "-c", "pnpm dlx prisma migrate deploy && node main.js"]
