---
name: deploy
description: "À appeler pour vérifier un diff qui touche .github/workflows, docker-compose*, infra/, tools/load*, tools/scripts ou une procédure de déploiement. À lire aussi avant de toucher à la CI, à la CD ou aux VPS."
tools: Read, Grep, Glob, Bash
---

# Agent Deploy — VPS, Docker, CI/CD, Nx

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- .github docker-compose*.yml infra tools`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. `pnpm` / `pnpm dlx` seulement, jamais `npm` / `npx`.
2. Aucun secret en dur : GitHub Secrets / environnements `production` et `staging`.
3. Bon fichier compose par environnement (`docker-compose.dev.yml` / `.prod.yml`), jamais le `docker-compose.yml` par défaut pour recréer une API.
4. Redis isolé par `REDIS_DB` / `REDIS_PREFIX`, jamais `REDIS_URL`.
5. Connexions DB : l'API passe par PgBouncer (6432, SCRAM), les migrations par `DATABASE_DIRECT_URL`, jamais par PgBouncer.
6. Nouvelle variable d'environnement listée dans `reference/deploy/variables-env.md` (et absente → comportement sûr).
7. Fronts statiques : releases + lien symbolique, retour arrière possible sans rebuild.
8. API : déploiement blue/green sans coupure, CD ciblé (pas de redéploiement inutile).
9. Workflow : aucune étape sautée ni seuil baissé pour faire passer au vert ; `concurrency` et environnements inchangés sans raison.
10. Aucune action sur un VPS, la prod ou Stripe live sans accord explicite de Greg (`decisions.md`) : les commandes sont données à Greg, une par une, avec sauvegarde datée à la minute.
11. Vérifications post-deploy prévues (section dédiée).
12. VPS prod partagé avec un autre projet hébergé (2026-11-25) : tout nouveau routeur Traefik doit déclarer `middlewares=security-headers@file`. Ne jamais remettre de middleware sur l'entrypoint `websecure` ni toucher au résolveur secondaire / à l'override réseau du serveur (autre projet hébergé). Ne jamais construire d'image hors limites mémoire sans vérifier la RAM libre : le VPS est partagé.

Réponse, toujours ce format, court :
```
Domaine : deploy
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Infrastructure

> **Deux VPS depuis la bascule du 2026-10-15 (21 h 14)** :
> - **VPS prod** `greg@149.202.40.240` (`mtc-prod`) : API prod blue/green + worker, Postgres/PgBouncer/Redis
>   prod, app Angular prod (`app.`), bot Discord, sauvegardes prod. Référence (durcissement, rôles
>   Postgres, sauvegardes, secrets) : `infra/prod/README.md`. Secrets GitHub `PROD_VPS_HOST` / `PROD_VPS_SSH_KEY` / `PROD_VPS_KNOWN_HOSTS`.
>   **Partagé depuis le 2026-11-25 avec un autre projet hébergé**, indépendant (ses bases, réseaux et
>   sauvegardes), qui ne partage que Traefik : en-têtes de sécurité déclarés routeur par routeur
>   (`security-headers@file`), aucun middleware sur l'entrypoint `websecure` ; le résolveur ACME
>   secondaire et le `docker-compose.override.yml` (réseaux) du serveur sont à cet autre projet, jamais
>   supprimés ni recopiés dans le dépôt. 6 vCPU ; limites : API 1,5 Gio par couleur (2 workers),
>   worker 768 Mio, Postgres 1 Gio, Redis 320 Mio, Traefik 384 Mio, builds dans le builder plafonné
>   `mtc-build` (1,5 Gio, `infra/build-image.sh`) : 4 Gio garantis à l'autre projet (#1286,
>   `reference/deploy/maintenance-vps.md`).
> - **Ancien VPS** `51.83.197.230` (schéma ci-dessous, dont les lignes prod sont périmées) : API, bases et
>   apps **dev et beta**, plus **landing (`www.`) et admin (`admin.`) de prod**. Secrets `VPS_HOST` / `VPS_SSH_KEY` / `DEV_VPS_KNOWN_HOSTS`.
>
> **Décision (2026-10-16) : landing et admin restent sur l'ancien VPS. Pas de Vercel, pas de changement
> de DNS pour eux.** Toute mention d'un passage sur Vercel est caduque.
>
> **L'admin n'a pas d'environnement dev** (ni beta) : un seul site, `admin.mytradingcoach.app`, publié
> par `cd.yml` depuis `main`. Une modification de l'admin n'est visible en ligne qu'après promotion
> sur `main` ; avant, la tester en local (`pnpm nx serve admin-mytradingcoach`) contre l'API dev.
>
> **Accès SSH de l'admin (page Surveillance, sauvegardes, logs)** : c'est l'API prod qui se connecte, avec
> **une clé par serveur** (état du 2026-10-17).
> - Serveur `principal` = `VPS_HOST=149.202.40.240` (`VPS_LABEL=VPS prod`) : clé **`mtc-api-prod-admin`**
>   (`VPS_SSH_KEY_B64`, `VPS_USER=greg`), autorisée chez `greg` **sur le VPS prod seulement**, avec
>   `from="172.16.0.0/12"` (réseau Docker local), `no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty`.
>   Toutes les actions (stats, containers, logs, sauvegardes).
> - Serveur `secondaire` = `VPS_SECONDARY_HOST=51.83.197.230` (`VPS_SECONDARY_LABEL=VPS dev · beta`),
>   onglet de la page Surveillance (#569) : **lecture seule**, clé dédiée `mtc-api-prod-secondaire-ro`
>   (`VPS_SECONDARY_SSH_KEY_B64`, empreinte d'hôte épinglée par `VPS_SECONDARY_HOST_KEY_SHA256`),
>   utilisateur **`mtc-monitor`** sur l'ancien VPS : `from="149.202.40.240"`, `restrict`, commande forcée
>   `/usr/local/bin/mtc-monitor-ro` qui n'exécute que `/etc/mtc-monitor/allowed-commands` (copie de
>   `infra/vps/mtc-monitor-allowed-commands`, générée depuis `vps-commands.ts`). Actions et logs refusés
>   en 403 par l'API. Sans `VPS_SECONDARY_SSH_KEY_B64`, l'onglet n'est pas proposé.
> - **`mtc-api-prod-admin` n'est plus autorisée sur l'ancien VPS** (retirée de `~greg/.ssh/authorized_keys`
>   le 2026-10-17) : l'API n'y a plus de shell. Le code ne se rabat jamais sur la clé du principal.
> - ⚠️ fail2ban de l'ancien VPS (5 échecs / 10 min → ban 1 h) : une clé refusée depuis 149.202.40.240
>   finit par bannir le VPS prod (l'API ne retente plus qu'une fois par minute). Débannir :
>   `sudo fail2ban-client set sshd unbanip 149.202.40.240` (terminal de Greg : Claude ne fait plus de
>   `sudo`). Le VPS prod n'est pas en `ignoreip`.
> - Rotation des clés : principal → `VPS_SSH_KEY_B64` + `authorized_keys` de greg **sur le VPS prod** ;
>   secondaire → `VPS_SECONDARY_SSH_KEY_B64` + `authorized_keys` de `mtc-monitor` sur l'ancien VPS (avec
>   les options `from=…,command=…,restrict`). Puis redéployer l'API prod (`deploy-api.sh` recrée les
>   conteneurs ; `docker restart` ne relit pas l'env). Procédure détaillée : `docs/ops/maintenance-2026-10-17.md`.

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
jamais par PgBouncer (mode réel : session, constaté le 2026-11-21, #1110 ; voir `reference/commun/pgbouncer.md`).

---

## Commandes Nx — PNPM exclusivement

```bash
# Dev
pnpm nx serve app-mytradingcoach       # Angular  → localhost:4200
pnpm nx serve api-mytradingcoach       # NestJS   → localhost:3000 (port par défaut ; en dev local : PORT=3001, voir angular « Environments »)
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
      - "traefik.http.routers.api-prod-secure.rule=Host(`api.mytradingcoach.app`)"
      - "traefik.http.routers.api-prod-secure.entrypoints=websecure"
      - "traefik.http.routers.api-prod-secure.tls.certresolver=letsencrypt"
      - "traefik.http.routers.api-prod-secure.middlewares=security-headers@file"
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
# Migrations via connexion directe, jamais via PgBouncer
DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" \
  ./node_modules/.bin/prisma migrate deploy --config=./prisma/prisma.config.ts
echo "[entrypoint] Migrations complete. Starting NestJS..."
exec node main.js
```

---

## CI/CD GitHub Actions

> **Budget Actions (2026-10-07)** : tout job porte un `timeout-minutes` (≈ 3–4× sa durée normale :
> 5 à 25 min) ; sans lui, GitHub laisse tourner un job bloqué **6 h**. Vu le 07/10 : l'installation
> de Playwright du smoke E2E bloquée 15 min et plus (étape plafonnée à 5 min depuis). Nouveau job →
> `timeout-minutes` obligatoire. Les jobs `uses:` (workflow réutilisable) n'en acceptent pas : ce
> sont les jobs de `checks.yml` qui le portent. Travail direct sur `dev` / `beta` (pas de PR vers
> elles) : un push = un seul run.
>
> **Images des services de test (2026-10-15)** : postgres et redis des jobs de test sont tirés sur
> `mirror.gcr.io/library/…` (cache Docker Hub de Google, anonyme, sans secret). Docker Hub puis le
> miroir ECR Public (`public.ecr.aws`) renvoyaient `toomanyrequests` : quota anonyme compté par IP,
> et les IP des runners sont partagées. Ne pas y revenir.

### Branches
- `dev` → deploy automatique en dev (VPS via rsync GitHub Actions)
- `main` → deploy production (après CI verte + PR)

### Workflows planifiés
- **Veille règles prop firm** (`prop-firm-watch.yml`, lundi 06:00 UTC + manuel) : `pnpm prop-firms:watch` relit les
  sources du catalogue prop firm et ouvre ou commente une issue `veille-prop-firm` s'il y a un article modifié ou une
  firm à revérifier (> 30 jours). Lecture seule, aucun secret (`GITHUB_TOKEN`, `issues: write`). Un `schedule` ne
  tourne que depuis la branche par défaut (`main`) : il n'est actif qu'une fois promu en prod. Marche à suivre :
  README de `libs/shared/src/prop-firm-rules/`, section « Veille automatique ».
- **E2E de nuit** (`e2e-nightly.yml`, 02:30 UTC + manuel, #694) : `12-activation` sur `dev` (checkout
  `ref: dev`), base éphémère. Un premier job de quelques secondes saute la suite si `dev` n'a pas de
  commit depuis 24 h. Aucun secret (clés factices, `LOAD_TEST_KEY` de test). Détails : `tests.md`.

### Secrets GitHub requis

**Environment `production` :**
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` : ancien VPS (landing et admin de prod ; dev et beta passent par `staging`), fronts publiés en releases par `infra/deploy-static.sh`
- `PROD_VPS_HOST`, `PROD_VPS_SSH_KEY` : VPS prod (API prod et app prod, `cd.yml` et `deploy-api-manual.yml`) ; même `VPS_USER`
- `PROD_VPS_KNOWN_HOSTS` : clé d'hôte du VPS prod, une ligne known_hosts (`149.202.40.240 ssh-ed25519 AAAA…`), lue par le job app prod de `cd.yml` à la place de `ssh-keyscan`. Le scan ouvre des connexions sans authentification que fail2ban compte comme des échecs : runner banni, rsync en « Connection timed out » (2026-10-16). À refaire si la clé d'hôte du VPS change (réinstallation).
- `DEV_VPS_KNOWN_HOSTS` : clé d'hôte de l'ancien VPS (`51.83.197.230 ssh-ed25519 AAAA…`), même rôle pour tous les jobs qui publient dessus (`cd.yml` admin et landing, `ci.yml` app et landing dev, `beta.yml` app beta). **Plus aucun `ssh-keyscan` dans les workflows** : un job sans son secret s'arrête net (« secret … absent »). Secret présent dans `production` (admin et landing de prod) **et** dans `staging` (dev et beta).

**Environment `staging` :** jobs de déploiement dev et beta (`ci.yml` `deploy-*-dev`, `beta.yml` `deploy-*-beta`). Secrets : `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DEV_VPS_KNOWN_HOSTS`. Aucun secret du VPS prod. `production` ne sert qu'aux jobs de `main` (`cd.yml`, `deploy-api-manual.yml`).

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

---

## Index des règles déplacées (résumé)

- **Fronts statiques** : releases + lien symbolique, `deploy-static.sh`, retour arrière immédiat sans rebuild (`reference/deploy/fronts-statiques.md`).
- **Variables d'environnement** : liste complète dans `reference/deploy/variables-env.md` ; une nouvelle variable y est ajoutée.
- **Redis** : isolé par `REDIS_DB` / `REDIS_PREFIX`, jamais `REDIS_URL` (`reference/deploy/redis-isolation.md`).
- **PgBouncer** : port 6432, SCRAM obligatoire (`reference/commun/pgbouncer.md`).
- **Export RGPD d'un compte** : procédure pour Greg (lecture seule `mtc_readonly`, rien copié sur l'hôte, archive 7z chiffrée) dans `docs/ops/export-donnees-sur-demande.md`, script `tools/scripts/ops/export-user-data.mjs` (`--check` avant chaque export).

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `deploy/api-deploiement.md` | déploiement de l'API (blue/green, CD ciblé, workers, keep-alive) |
| `deploy/backups-supervision.md` | sauvegardes, hors-site, supervision |
| `deploy/fronts-statiques.md` | déploiement d'un front statique, nginx, retour arrière |
| `deploy/lancement-charge.md` | jour J, tests de charge |
| `deploy/maintenance-vps.md` | maintenance des VPS |
| `deploy/redis-isolation.md` | Redis par environnement |
| `deploy/sentry.md` | Sentry |
| `deploy/variables-env.md` | nouvelle variable d'environnement |
| `commun/pgbouncer.md` | pool Postgres, PgBouncer, SCRAM |
| `commun/push-admin.md` | notifications push / PWA de l'admin |
