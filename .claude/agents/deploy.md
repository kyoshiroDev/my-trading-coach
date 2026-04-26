# Agent Deploy — VPS, Docker, CI/CD, Nx

## Infrastructure

```
VPS OVH — 51.83.197.230 (user: greg)
├── mtc_traefik     → reverse proxy + SSL Let's Encrypt
├── mtc_postgres    → PostgreSQL 17 (partagé prod/dev) — port 5432
├── mtc_pgbouncer   → PgBouncer connection pooling — port 6432
├── mtc_redis       → Redis 7.4 (partagé prod/dev)
├── mtc_api_prod    → NestJS production (/opt/apps/mytradingcoach/prod/)
└── mtc_api_dev     → NestJS dev      (/opt/apps/mytradingcoach/dev/)

Configs infra :
├── /opt/infra/databases/docker-compose.yml  ← postgres + pgbouncer + redis
└── /opt/infra/traefik/docker-compose.yml    ← traefik
```

---

## Architecture connexions DB

```
NestJS (4 workers) → mtc_pgbouncer:6432 → mtc_postgres:5432
                     (200 clients, 25 conn)
```

Les migrations Prisma passent par `DATABASE_DIRECT_URL` (Postgres direct),
jamais par PgBouncer (transaction mode incompatible DDL).

---

## Commandes Nx — PNPM exclusivement

```bash
# Dev
pnpm nx serve app-mytradingcoach       # Angular  → localhost:4200
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000
pnpm nx dev   landing-mytradingcoach   # Astro    → localhost:4321

# Build
pnpm nx build app-mytradingcoach --configuration=production
pnpm nx build api-mytradingcoach --configuration=production
pnpm nx build landing-mytradingcoach

# Tests
pnpm nx test app-mytradingcoach
pnpm nx test api-mytradingcoach
pnpm nx e2e  app-mytradingcoach-e2e

# Lint
pnpm nx lint app-mytradingcoach
pnpm nx lint api-mytradingcoach
pnpm nx lint landing-mytradingcoach

# Affected (CI)
pnpm nx affected --target=build --base=origin/main --head=HEAD
```

---

## Docker

### docker-compose.yml app (prod/dev)

L'app ne contient QUE le service api. Postgres, PgBouncer et Redis sont dans
`/opt/infra/databases/docker-compose.yml` et partagés via `mtc_network`.

```yaml
services:
  api:
    build:
      context: .
      dockerfile: apps/api-mytradingcoach/Dockerfile
    image: mtc_api_prod:latest
    container_name: mtc_api_prod
    restart: unless-stopped
    env_file: .env.production
    networks: [ mtc_network ]
    mem_limit: 512m
    memswap_limit: 512m
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api-prod.rule=Host(`api.mytradingcoach.app`)"
      - "traefik.http.routers.api-prod.entrypoints=websecure"
      - "traefik.http.routers.api-prod.tls.certresolver=letsencrypt"
      - "traefik.http.services.api-prod.loadbalancer.server.port=3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  mtc_network:
    external: true
```

### Dockerfile NestJS (réel)

```dockerfile
FROM node:22-slim AS builder
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build api-mytradingcoach --configuration=production --skip-nx-cache

FROM node:22-alpine AS migrator
RUN npm install -g pnpm@10 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
RUN pnpm dlx prisma generate --config=./prisma/prisma.config.ts

FROM node:22-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nestjs -G nodejs
WORKDIR /app
COPY --from=builder /app/apps/api-mytradingcoach/dist ./
COPY --from=migrator --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/apps/api-mytradingcoach/node_modules ./apps/api-mytradingcoach/node_modules
COPY --from=migrator --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs apps/api-mytradingcoach/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENV NODE_PATH=/app/apps/api-mytradingcoach/node_modules
USER nestjs
EXPOSE 3000
CMD ["sh", "entrypoint.sh"]
```

### entrypoint.sh

```sh
#!/bin/sh
set -e
echo "[entrypoint] Running Prisma migrations..."
# Migrations via connexion directe — PgBouncer (transaction mode) incompatible DDL
DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" \
  ./node_modules/.bin/prisma migrate deploy --config=./prisma/prisma.config.ts
echo "[entrypoint] Migrations complete. Starting NestJS..."
exec node main.js
```

---

## CI/CD GitHub Actions

### Branches
- `dev` → deploy automatique en dev (VPS + Vercel preview)
- `main` → deploy production (après CI verte + PR)

### Secrets GitHub requis

**Environment `production` :**
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`
- `VERCEL_APP_PROJECT_ID`, `VERCEL_LANDING_PROJECT_ID`

**Environment `development` :**
- Même secrets + `DEV_API_URL`

### Deploy prod VPS

```bash
cd /opt/apps/mytradingcoach/prod
git pull origin main
docker compose build api
docker compose up -d --force-recreate api
# Les migrations tournent automatiquement dans entrypoint.sh via DATABASE_DIRECT_URL
```

### Deploy dev VPS

```bash
cd /opt/apps/mytradingcoach/dev
git pull origin dev
docker compose build api
docker compose up -d --force-recreate api
```

---

## Vercel

- **App Angular** : `app-mytradingcoach` → `app.mytradingcoach.app`
- **Landing Astro** : `landing-mytradingcoach` → `mytradingcoach.app`
- Build via `--prebuilt` depuis GitHub Actions (Vercel ne build pas lui-même)
- Ignored Build Step : `exit 1` (build géré par CI)

---

## Backups & Monitoring

```bash
# Backups automatiques (crons VPS)
# 22h45 dimanche → backup images Docker + configs → /opt/backups/apps/
# 23h00 chaque soir → pg_dump prod + dev → /opt/backups/postgres/
# Rétention 30 jours, notifications Discord par backup

# Monitoring containers (cron toutes les 2 min)
# /opt/apps/monitor-containers.sh → Discord si container down/up
```

---

## Vérifications post-deploy

```bash
# Santé API prod
curl https://api.mytradingcoach.app/api/health

# Logs en temps réel
docker logs mtc_api_prod -f

# Status tous les containers
docker ps --format 'table {{.Names}}\t{{.Status}}'

# Vérifier PgBouncer opérationnel
docker logs mtc_pgbouncer --tail=5
```

---

## Variables d'environnement requises (.env.production)

```bash
NODE_ENV=production

# DB — DATABASE_URL pointe vers PgBouncer, DIRECT vers Postgres (migrations)
DATABASE_URL=postgresql://mtc_user:PASSWORD@mtc_pgbouncer:6432/mytradingcoach_prod?pgbouncer=true&connection_limit=1
DATABASE_DIRECT_URL=postgresql://mtc_user:PASSWORD@mtc_postgres:5432/mytradingcoach_prod

REDIS_HOST=mtc_redis
REDIS_PORT=6379
REDIS_PASSWORD=...
REDIS_URL=redis://:PASSWORD@mtc_redis:6379

JWT_SECRET=...           # 64 chars minimum
JWT_REFRESH_SECRET=...   # 64 chars minimum
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...
RESEND_API_KEY=re_...
MAIL_FROM=noreply@mytradingcoach.app
FRONTEND_URL=https://app.mytradingcoach.app
CORS_ORIGINS=https://app.mytradingcoach.app,https://mytradingcoach.app
PORT=3000
```
