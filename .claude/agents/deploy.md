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
- `dev` → deploy automatique en dev (VPS via rsync GitHub Actions)
- `main` → deploy production (après CI verte + PR)

### Secrets GitHub requis

**Environment `production` :**
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (le front est rsync sur le VPS, plus de Vercel)

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

## Front statique sur le VPS (plus de Vercel)

App Angular, admin et landing Astro sont **buildés dans GitHub Actions** (cd.yml) puis **rsync** vers
le VPS, servis par des conteneurs **nginx:alpine derrière Traefik** (TLS letsencrypt + routing par
Host + redirect non-www→www en middleware Traefik).

- App Angular : `dist/apps/app-mytradingcoach/browser/` → `/opt/static/app-prod` → `app.mytradingcoach.app`
- Admin : `dist/apps/admin-mytradingcoach/browser/` → `/opt/static/admin` → `admin.mytradingcoach.app`

> ⚠️ **L'admin se déploie depuis `main`, comme l'app et la landing.** Jusqu'au 31/08/2026
> deux chaînes coexistaient : `ci.yml` publiait l'admin sur un push `dev` vers
> `/opt/static/admin` (le répertoire réellement servi), pendant que `cd.yml` publiait
> depuis `main` vers `/opt/static/admin-prod`, que **rien ne montait**. Résultat : la
> production admin était alimentée par `dev`, et les déploiements issus de `main`
> partaient dans le vide depuis le 17/08/2026. Le job admin de `ci.yml` a été supprimé,
> `cd.yml` pointe désormais sur `/opt/static/admin`, et `admin-prod` a été supprimé du
> VPS. Le répertoire servi est celui monté par `mtc_admin` dans
> `/opt/infra/static/docker-compose.yml` — c'est lui qui fait foi, pas le nom du dossier.
- Landing Astro : `apps/landing-mytradingcoach/dist/` → `/opt/static/landing-prod` → `www.mytradingcoach.app`

⚠️ La config nginx de chaque site vit **sur le VPS** (`/opt/infra/static/nginx/*.conf`), pas dans le
dépôt (le `nginx/nginx.conf` du dépôt est un vestige mort). Compose infra : `/opt/infra/static/`.
La landing exige `PUBLIC_FEATURE_MULTI_ACCOUNTS=true` + `PUBLIC_FEATURE_REFERRAL=true` au build
(sinon `/journal-trading-prop-firm` et `/ambassadeur` redirigent vers `/`) — déjà dans cd.yml/ci.yml.

---

## Backups & Monitoring

```bash
# Backups automatiques (crons VPS, user greg)
# 03h00 chaque nuit  → pg_dump prod + dev + beta → /opt/backups/mtc/   (rétention 14 j)
# 03h30 chaque nuit  → docker system prune + builder prune
# 04h00 dimanche     → docker buildx prune --keep-storage=8GB
# 22h45 dimanche     → images Docker + configs   → /opt/backups/apps/  (rétention 30 j)
# Pas de notification Discord (webhooks morts, retirés) — le contrôle de
# fraîcheur se fait dans l'app admin, qui lit /opt/backups/mtc.
#
# ⚠️ Les logs de ces crons vont dans /opt/backups/*.log et JAMAIS dans /var/log/ :
# greg ne peut pas y créer de fichier, et une redirection qui échoue à
# l'ouverture empêche le job de s'exécuter sans laisser la moindre trace.

```

### Format et périmètre des dumps BDD

```
Répertoire : /opt/backups/mtc/          (surveillé par l'app admin via BACKUP_DIR)
Script     : /opt/backups/mtc/backup.sh
Format     : mtc_<prod|dev|beta>_YYYYMMDDTHHMM_<auto|manual>.sql.gz
Commande   : docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_<env> | gzip > ...
```

Les **3 environnements** sont dumpés : `prod` (requis — le script sort en erreur
si son dump échoue), `dev` et `beta` (optionnels). Un dump vide ou tronqué est
**supprimé** plutôt que conservé, pour ne pas donner une fausse impression de
sécurité.

`BackupService` déduit l'environnement du **nom de fichier** (`_dev_` / `_beta_`,
sinon `prod`) → ajouter une base au backup impose de toucher **3 endroits**, sinon
le dump s'affiche sous le mauvais environnement dans l'admin :
`backup.sh` (VPS) · `backup.service.ts` (`DB_BY_TARGET`, `LABEL_BY_TARGET`,
`targetFromFilename`) · `TARGET_CONFIG` du front admin.

### Monitoring — ⚠️ inexistant

`/opt/apps/monitor-containers.sh` a disparu du VPS et n'est plus dans le cron
(vérifié le 10 août 2026). Les webhooks Discord sont morts par ailleurs. Il n'y a
donc **aucune alerte automatique** : ni sur un conteneur qui tombe, ni sur un
backup qui échoue. Le seul contrôle est l'app admin, qui suppose une consultation
manuelle.

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
