---
name: deploy
description: "Déploiement et infra : VPS, Docker, Traefik, nginx statique, GitHub Actions, commandes Nx. À lire avant de toucher aux workflows, docker-compose ou à la mise en production."
---

# Agent Deploy — VPS, Docker, CI/CD, Nx

## Infrastructure

```
VPS OVH — 51.83.197.230 (user: greg)
├── mtc_traefik     → reverse proxy + SSL Let's Encrypt
├── mtc_postgres    → PostgreSQL 17 (partagé prod/dev) — port 5432
├── mtc_pgbouncer   → PgBouncer connection pooling — port 6432
├── mtc_redis       → Redis 7.4 (prod en base 0 ; dev doit avoir REDIS_DB=1 + REDIS_PREFIX=dev:)
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
RUN npm install -g pnpm@11.6.0 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api-mytradingcoach/package.json ./apps/api-mytradingcoach/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build api-mytradingcoach --configuration=production --skip-nx-cache

FROM node:22-alpine AS migrator
RUN npm install -g pnpm@11.6.0 --no-fund --no-audit
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

**Pages gatées flag OFF → 301 Nginx (recommandé).** Astro ne sait faire qu'une redirection
`<meta http-equiv="refresh">` (page HTML servie en 200, puis redirection à 2 s) : acceptable
(page en `noindex`, hors sitemap), mais une 301 est plus propre pour Google et plus rapide.
Quand un flag est OFF sur un environnement, ajouter dans la conf nginx de la landing
(`/opt/infra/static/nginx/`, bloc `server` de la landing), puis recharger son conteneur nginx
(nom dans `/opt/infra/static/docker-compose.yml`) avec `nginx -s reload` :

```nginx
# Flag PUBLIC_FEATURE_REFERRAL=false
location = /ambassadeur { return 301 /; }
# Flag PUBLIC_FEATURE_MULTI_ACCOUNTS=false
location = /journal-trading-prop-firm { return 301 /; }
```

Retirer la ligne le jour où le flag passe à `true`, sinon la page publiée reste inaccessible.

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
# Santé API prod : process (liveness) puis dépendances Postgres + Redis (readiness)
curl https://api.mytradingcoach.app/api/health
curl https://api.mytradingcoach.app/api/health/ready

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
# REDIS_DB / REDIS_PREFIX : voir « Isolation Redis » ci-dessous. Prod : ni l'un ni l'autre.

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

### Tradovate / NinjaTrader (PROMPT-207) — optionnelles, feature désactivée sans elles

```bash
TRADOVATE_OAUTH_CLIENT_ID=...        # inscription OAuth MTC (≠ TRADOVATE_API_CID perso)
TRADOVATE_OAUTH_CLIENT_SECRET=...
TRADOVATE_OAUTH_REDIRECT_URI=https://api.mytradingcoach.app/integrations/tradovate/callback
BROKER_TOKEN_ENCRYPTION_KEY=...      # openssl rand -base64 32 — UNE par env, jamais réutilisée
```

- Pendant le développement, l'inscription OAuth côté Tradovate pointe sur **beta**
  (`https://beta.api.mytradingcoach.app/integrations/tradovate/callback`) : `.env.beta` porte
  cette URI. Repasser l'inscription ET `.env.production` sur l'URL prod uniquement au ship.
- **Temps réel (PROMPT-210 live)** : aucune variable en plus. Le canal `/tradovate-live` passe
  par socket.io sur l'hôte `api.` (comme `/eco`, déjà routé par Traefik) ; l'API ouvre en
  sortie des `wss://{live|demo}.tradovateapi.com`. Redis requis pour le bail « un WebSocket
  Tradovate par user » entre workers (sans Redis : au pire un par worker). Nouveau cron
  `TradovateBackgroundRefreshCron` (toutes les 30 min, worker cron uniquement).
- Le callback est servi **hors `/api`** : Traefik route tout l'hôte `api.` vers le conteneur,
  rien à ajouter. Vérif post-deploy : `curl -sI https://<api>/integrations/tradovate/callback`
  → `302` vers `<FRONTEND_URL>/accounts?tradovate=error&reason=session_expired` (normal sans cookie).
- Changer `BROKER_TOKEN_ENCRYPTION_KEY` rend toutes les connexions illisibles : les users
  devront se reconnecter (aucun trade perdu).

## Isolation Redis entre environnements (SCA-B0-01, 2026-09-30)

⚠️ **`REDIS_URL` n'est lu par AUCUN code.** Seuls `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`,
`REDIS_DB` et `REDIS_PREFIX` comptent (`modules/infra/redis-config.ts`). Constaté le 30/09 : le
`/1` du `REDIS_URL` de dev était ignoré, donc **dev et prod partageaient la base 0 de `mtc_redis`**
et le worker dev pouvait consommer les jobs `stripe` / `debrief` de la prod.

| Variable | Défaut | Effet |
|---|---|---|
| `REDIS_DB` | `0` | base Redis de toutes les connexions (cache, throttler, BullMQ, socket.io) |
| `REDIS_PREFIX` | vide | préfixe des clés (`keyPrefix`), des files (`<prefix>bull`) et du canal socket.io |

Le canal socket.io porte aussi la base (`socket.io:db1`) : le pub/sub Redis ignore le numéro de
base, sans ça deux environnements sur deux bases se diffuseraient leurs événements.

| Env | Serveur | `REDIS_DB` | `REDIS_PREFIX` |
|---|---|---|---|
| prod | `mtc_redis` | *(absent → 0)* | *(absent)* : **ne pas en ajouter**, les clés et jobs existants seraient orphelins |
| dev | `mtc_redis` | `1` | `dev:` |
| beta | `mtc_redis_beta` (serveur à part) | *(absent → 0)* | *(absent)* ; supprimer le `REDIS_URL` périmé de `.env.beta` (pointe sur `mtc_redis`) |

**Ordre de remise en route de dev** (arrêté le 30/09 à cause du partage) : déployer le code
contenant SCA-B0-01 sur dev, ajouter `REDIS_DB=1` et `REDIS_PREFIX=dev:` à `.env.dev`, **puis
seulement** relancer `mtc_api_dev`. Un push sur `dev` avant ça relance le conteneur sur la base
partagée.

Plus aucun `KEYS` dans le code : `RedisService.scanKeys()` (SCAN par lots, préfixe géré). Les
échecs de jobs BullMQ sont gardés 7 jours / 1 000 au plus (`removeOnFail`), Redis étant en
`noeviction`.

## Mémoire et workers de l'API (SCA-B0-02, 2026-09-30)

- `WEB_CONCURRENCY` : nombre de workers HTTP, défaut `min(cœurs, 3)`. Au démarrage, le primaire
  journalise le nombre retenu et le plafond de tas.
- Compose prod / dev / beta : `NODE_OPTIONS=--max-old-space-size=384`, `mem_limit: 2g`,
  `memswap_limit: 2g`, `stop_grace_period: 30s`.
- Le healthcheck Docker reste sur `/api/health` (liveness) **volontairement** : Traefik n'envoie
  aucun trafic à un conteneur `unhealthy`, et une coupure Redis passagère rendrait alors toute
  l'API injoignable alors qu'elle sait tourner en mode dégradé. `/api/health/ready` sert au
  garde-fou du CD et à la supervision externe.
- Les plafonds de 2 Gio sont des maxima, pas des réservations. Sur le VPS de 7,6 Go, dev et beta
  n'ont pas vocation à tourner à plein en même temps que la prod pendant un pic.

## Pool Postgres et PgBouncer (SCA-B0-05, 2026-09-30)

**Côté API** (`prisma/pool-config.ts`) : `DB_POOL_MAX` connexions par process (défaut **5**), soit
15 pour la prod à 3 workers. `connectionTimeoutMillis` 5 s, `idleTimeoutMillis` 10 s,
`query_timeout` 15 s (côté client).

⚠️ **Jamais de `statement_timeout` dans la config `pg`** : node-postgres l'envoie en paramètre de
démarrage, que PgBouncer refuse (`ignore_startup_parameters = extra_float_digits` seulement) →
plus aucune connexion en prod, alors que tout passe en local (pas de PgBouncer). Un plafond
serveur se règle dans Postgres (`ALTER ROLE … SET statement_timeout`), pas dans l'API.

**Côté VPS** (mesuré le 30/09) : `max_connections = 50`, PgBouncer 1.15 en `transaction`,
`DEFAULT_POOL_SIZE=25` **par base** × 3 bases = 75 > 50. Bloc proposé pour
`/opt/infra/databases/docker-compose.yml` (service pgbouncer), **à appliquer en SCA-B7-02 après
validation**, hors heures de marché US :

```yaml
environment:
  # remplace DEFAULT_POOL_SIZE=25 appliqué à toutes les bases
  DATABASES: >-
    mytradingcoach_prod = host=mtc_postgres port=5432 pool_size=25,
    mytradingcoach_dev  = host=mtc_postgres port=5432 pool_size=5,
    mytradingcoach_beta = host=mtc_postgres port=5432 pool_size=5
  RESERVE_POOL_SIZE: 5
  MAX_DB_CONNECTIONS: 40   # garde de la marge sous max_connections=50 (migrations, admin, psql)
```

Retour arrière : restaurer `DEFAULT_POOL_SIZE=25` et retirer ces trois lignes, puis
`docker compose up -d pgbouncer`.

## CD de l'API : déploiement ciblé, garde-fou et gel (SCA-B0-08, 2026-09-30)

- `deploy-api` ne tourne que si `changes.outputs.api == 'true'` : projet Nx `api-mytradingcoach`
  affecté, **ou** fichier touché sous `prisma/`, `libs/`, `scripts/discord-bot/`,
  `docker-compose.{prod,discord-bot}.yml`, `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` (Nx ne rattache pas ces chemins à un projet). Un commit landing seul ne
  redémarre plus l'API.
- Après `up`, le job attend `/api/health/ready` (Postgres + Redis) jusqu'à **90 s**, sinon il
  échoue en affichant les 80 dernières lignes de logs, et `deployed/prod` ne bouge pas.
- **Gel** : variable de dépôt `FREEZE_API_DEPLOY=true` (Settings → Secrets and variables →
  Actions → Variables). L'API n'est plus déployée, les fronts si. Tant que le gel est actif et
  que l'API a changé, le tag `deployed/prod` ne bouge pas : au dégel, le CD suivant redéploie bien
  les changements gelés. Retirer la variable (ou la passer à `false`) pour dégeler.

## Sentry (SCA-B0-09, 2026-09-30)

- Actif dès que `SENTRY_DSN` est défini (`src/instrument.ts`) : `sampleRate 1`, `tracesSampleRate 0`
  (aucun surcoût), `sendDefaultPii false`, `environment` = `SENTRY_ENVIRONMENT` ou `NODE_ENV`,
  `release` = SHA court du commit (le CD exporte `GIT_SHA`, le compose le passe en `SENTRY_RELEASE`).
- **Où mettre le DSN** : créer un projet Node.js sur sentry.io (offre gratuite), copier le DSN dans
  `/opt/apps/mytradingcoach/prod/.env.production` (`SENTRY_DSN=…`, et `SENTRY_ENVIRONMENT=production`),
  puis recréer le conteneur. Même chose en beta/dev avec leur environnement si souhaité.
- Au 30/09, **aucun** des trois `.env` n'a de DSN : l'API prod l'affiche désormais en avertissement
  au démarrage.

## Supervision (SCA-B7-08, 2026-10-01)

**Interne — `infra/monitoring/watch-containers.sh`** (installé dans `/opt/backups/`, cron
`*/5 * * * *`, log `/opt/backups/watch-containers.log`) :
- conteneurs **critiques** (`mtc_api_prod`, `mtc_postgres`, `mtc_pgbouncer`, `mtc_redis`,
  `mtc_traefik`, `mtc_app_prod`, `mtc_landing_prod`, `mtc_admin`, `mtc_discord_bot`) : alerte s'ils
  sont arrêtés ;
- tous les `mtc_*` qui tournent : alerte si `unhealthy`, tués par OOM, ou **nouveau** redémarrage
  automatique depuis le passage précédent (`RestartCount` est cumulé : on compare au passage d'avant,
  mémorisé dans `/opt/backups/.watch-restarts`) ;
- dev et beta **arrêtés volontairement** (jour J) : pas d'alerte ;
- disque `/` ≥ 85 %.

E-mail via l'API Resend (clé lue dans `.env.production`) vers `hello@mytradingcoach.app`,
**seulement au changement d'état** (panne → 🔴, rétablissement → 🟢). L'état
(`/opt/backups/.watch-state`) n'est mémorisé qu'après un envoi réussi.
⚠️ Resend est derrière Cloudflare : sans `User-Agent` explicite, Python-urllib reçoit **403**.
Tests : `WATCH_DRY=1` (affiche l'état, n'envoie rien) · `WATCH_TEST=1` (envoie un e-mail de test).

**Externe — UptimeRobot** (plan gratuit, compte `hello@mytradingcoach.app`) : sondes HTTP toutes
les 5 min depuis l'extérieur, alerte e-mail vers `hello@mytradingcoach.app`. Elles détectent la perte
totale du VPS, que le script interne ne peut pas signaler.
| Sonde | URL |
|---|---|
| API prod - ready (Postgres + Redis) | `https://api.mytradingcoach.app/api/health/ready` (503 si Postgres ou Redis tombe) |
| app.mytradingcoach.app | `https://app.mytradingcoach.app` |
| Landing prod | `https://www.mytradingcoach.app/` |
| admin.mytradingcoach.app | `https://admin.mytradingcoach.app` |
Pas de sonde sur dev/beta (arrêtables volontairement). Nouvelle app publique → ajouter sa sonde.
