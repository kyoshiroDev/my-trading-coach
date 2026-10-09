# Contrôle du VPS — 30 septembre 2026 (partie A du prompt scalabilité 10k)

> Contrôles exécutés par l'agent en SSH (`greg@<VPS>`), **en lecture seule**, le 30/09 vers
> 17 h 30 (heure de Paris). Aucune écriture, aucun redémarrage, aucune commande hors de la liste
> blanche du prompt. Mots de passe transmis par variable (`REDISCLI_AUTH`), jamais affichés.
> Cahier des charges : `docs/audit-scalabilite-2026-09-30.md`.

## Synthèse

| Contrôle | Verdict | Conséquence |
|---|---|---|
| **A-01 Redis** | 🔴 **dev et prod partagent `mtc_redis` db 0** ; beta isolé | SCA-B0-01 confirmé et **urgent** ; mesure immédiate proposée (voir A-01) |
| A-02 Postgres / PgBouncer | 🟠 `max_connections = 50`, pool 25 par base, PgBouncer **1.15** | SCA-B0-05 confirmé ; pas de prepared statements nommés (< 1.21) |
| A-03 Volumétrie | 🟢 19 users, 911 trades, max 613 trades/user | Défauts de dimensionnement du prompt conservés (médiane 2 000, max 50 000) |
| A-04 Hôte | 🟢 marge large ; **swap 2 Go présent** ; `ulimit -n` API = 1024 | SCA-B7-01 réduit (somaxconn et swappiness déjà réglés) |
| A-05 nginx | 🟢 gzip et cache immuable déjà en place | SCA-B7-03 réduit à `gzip_static` + `open_file_cache` |
| A-06 Services tiers | ⏳ en attente de l'humain | Choix par défaut appliqués tant que sans réponse |
| A-07 Sauvegardes | 🔴 quotidiennes mais **uniquement sur le VPS** | SCA-B7-09 confirmé |

**Constats de l'audit corrigés par la mesure :**
- l'audit disait « pas de swap » : un `/swapfile` de 2 Go existe (140 Mo utilisés) ;
- Postgres est déjà en partie réglé (`shared_buffers` 1 920 Mo, `work_mem` 16 Mo,
  `random_page_cost` 1,1) ;
- `net.core.somaxconn = 4096` et `vm.swappiness = 10` sont déjà en place ;
- nginx compresse déjà en gzip et sert les fichiers hashés en `immutable`.

---

## 🤖 A-01 — Isolation Redis (audit C6)

**Commandes :** `grep '^REDIS_'` sur les `.env.*` de chaque environnement (valeurs sensibles
masquées), puis `redis-cli INFO keyspace`, `CONFIG GET maxmemory*`, `CONFIG GET appendonly`,
`INFO memory` et `--scan --pattern 'bull:*'` sur `mtc_redis` et `mtc_redis_beta`, db 0 et db 1.

**Variables par environnement :**

| Env | `REDIS_HOST` | `REDIS_URL` |
|---|---|---|
| prod | `mtc_redis` | `redis://:***@mtc_redis:6379` (db 0) |
| dev | `mtc_redis` | `redis://:***@mtc_redis:6379/1` |
| beta | `mtc_redis_beta` | `redis://:***@mtc_redis:6379/1` (**périmé**, pointe sur le Redis prod) |

**Code :** l'API ne lit **que** `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`
(`modules/infra/redis.service.ts:12`, `app/app.module.ts:64`,
`common/adapters/redis-io.adapter.ts:29`). `REDIS_URL` n'est lu nulle part : le `/1` de dev
est **ignoré**.

**État des Redis :**

| Conteneur | Clés db 0 | Clés db 1 | Files BullMQ (db 0) | `maxmemory` | Politique | AOF |
|---|---|---|---|---|---|---|
| `mtc_redis` (prod + dev) | 230 | **0** | `bull:stripe` 67, `bull:debrief` 23 | 256 Mo | `noeviction` | **non** |
| `mtc_redis_beta` | 36 | 0 | `bull:debrief` 33, `bull:stripe` 2 | 128 Mo | `noeviction` | non |

**Interprétation.** La db 1 est vide : dev écrit bien en db 0, **dans les mêmes clés que la
prod**. `mtc_api_dev` tourne en permanence et enregistre les mêmes processeurs BullMQ : il peut
consommer des jobs `stripe` (webhooks, commissions de parrainage) et `debrief` de la prod et les
traiter **contre la base dev**. Le job est alors perdu pour la prod. Idem pour les compteurs de
rate limit, les quotas IA et les caches. Beta est isolé.

**Conséquences :**
- **SCA-B0-01 confirmé, priorité absolue.** Les variables `REDIS_DB` / `REDIS_PREFIX` du prompt
  corrigent le fond.
- **Mesure immédiate proposée, en attente de validation** : arrêter `mtc_api_dev` jusqu'au
  déploiement de SCA-B0-01 (cohérent avec la décision D5, dev éteint hors tests).
- Nettoyer le `REDIS_URL` périmé de `.env.beta` (sans effet aujourd'hui, piège pour demain).
- Redis prod sans AOF : un redémarrage perd les jobs en attente. SCA-B7-05 (`appendonly yes`)
  confirmé.

## 🤖 A-02 — Postgres et PgBouncer (audit C5)

**PgBouncer** (image `pgbouncer/pgbouncer:latest`, configuré par variables d'environnement) :

```
POOL_MODE=transaction   DEFAULT_POOL_SIZE=25   MAX_CLIENT_CONN=200
DATABASES_HOST=mtc_postgres   DATABASES_PORT=5432   PgBouncer 1.15.0
```

**Postgres 17.9** :

| Paramètre | Valeur |
|---|---|
| `max_connections` | **50** |
| `shared_buffers` | 1 920 Mo |
| `work_mem` | 16 Mo |
| `effective_cache_size` | 5 760 Mo |
| `random_page_cost` | 1,1 |
| `pg_stat_statements` | disponible, **non installé** |
| Connexions actives | prod 4, dev 5, beta 2, postgres 1 |

Compose : `/opt/infra/databases/docker-compose.yml` (+ `docker-compose.beta.yml`, dossier
`pgbouncer/`).

**Interprétation.** 3 bases × 25 = 75 connexions serveur possibles pour 50 autorisées : sous
charge, les pools s'épuisent mutuellement. PgBouncer 1.15 ne gère pas les prepared statements
nommés en mode transaction : on garde le mode actuel (choix par défaut A-02).

**Conséquences :** SCA-B0-05 confirmé (pool applicatif `max: 5`, bloc PgBouncer prod 25 / dev 5 /
beta 5). SCA-B7-02 réduit : le tuning mémoire est déjà fait ; restent `max_connections = 100`,
`pg_stat_statements` et `log_min_duration_statement`. Montée de version PgBouncer à envisager.

## 🤖 A-03 — Volumétrie réelle (prod, agrégats uniquement)

```
users 19 · premium 2
trades par user : p50 37,5 · p90 269 · p99 579 · max 613
BrokerConnection : CONNECTED 5 · NEEDS_RECONNECT 2
```

Plus grosses tables : `MarketNews` 21 Mo (21 783 lignes), `AiUsageLog` 4,5 Mo (17 559),
`EcoEvent` 1,1 Mo, `Trade` 968 ko (911 lignes).

**Interprétation.** La prod est encore minuscule : aucun problème de volume aujourd'hui, les tests
de charge devront **fabriquer** le volume (seed beta, SCA-B9-01). `MarketNews` est déjà la plus
grosse table alors qu'elle ne concerne aucun utilisateur : la rétention (SCA-B5-09) est justifiée.

**Conséquences :** dimensionnement par défaut du prompt conservé. Index `CONCURRENTLY` inutile
(`Trade` ≪ 1 M lignes).

## 🤖 A-04 — Hôte et limites système

| Élément | Valeur |
|---|---|
| CPU / RAM / disque | 4 vCPU · 7,6 Go (2,5 utilisés, 5,1 disponibles) · 51 Go libres |
| Swap | **2 Go** (`/swapfile`, 140 Mo utilisés) |
| Charge | 0,00 / 0,06 / 0,12 |
| `somaxconn` / `tcp_max_syn_backlog` | 4096 / **512** |
| `vm.swappiness` / `overcommit_memory` | 10 / 0 |
| `ulimit -n` dans `mtc_api_prod` | **1024** |
| Docker | logs `json-file` 50 Mo × 3, GC builder 8 Go |
| Traefik | 2.11.42, `accessLog: {}` non bufferisé, **pas de compression**, pas de timeouts réglés |

Mémoire des conteneurs : `mtc_api_prod` 624 Mo / 1 Gio · `mtc_api_beta` 560 Mo / 1 Gio ·
`mtc_api_dev` 130 Mo / 1 Gio · `mtc_postgres` 149 Mo / 2,5 Gio · `mtc_redis` 3,5 Mo / 320 Mo.

**Interprétation.** La machine a de la marge ; le goulot est bien le conteneur API à 61 % de son
plafond au repos (audit C1). Un `ulimit -n` à 1024 plafonne les sockets simultanés d'un worker.

**Conséquences :** SCA-B7-01 réduit à `tcp_max_syn_backlog`, `ip_local_port_range` et
`ulimits nofile 65536`. SCA-B7-04 confirmé (compression, timeouts, rate limit de secours,
accessLog bufferisé).

## 🤖 A-05 — nginx des fronts

`spa.conf` (app, admin) et `landing.conf` : `gzip on` ; fichiers statiques en
`expires 1y` + `public, immutable` ; `index.html` en `no-cache` (app) et
`public, max-age=3600, must-revalidate` (landing).

Vu de l'extérieur : `app.` → `no-cache` ; `main-*.js` → `max-age=31536000` + `immutable`,
`content-encoding: gzip` ; `www.` → `max-age=3600`.

**Conséquences :** SCA-B7-03 réduit à `gzip_static` (fichiers `.gz` pré-générés en CD),
`open_file_cache`, et versionner ces confs dans `infra/nginx/`.

## 👤 A-06 — Quotas des services tiers

Présence des variables (valeurs jamais lues) : `SENTRY_DSN` **absent** des trois environnements ;
`RESEND_API_KEY` présent partout.

Questions posées à l'humain (a Resend, b Anthropic, c Tradovate, d données de marché, e Sentry,
f GitHub, g OVH, h NinjaTrader) : **réponses en attente**. Tant qu'elles manquent, les choix par
défaut du prompt s'appliquent (Resend gratuit → 1 e-mail/s et plus d'alerte admin par
inscription ; Anthropic tier 2 → 4 appels simultanés ; Tradovate inconnu → 5 synchros
simultanées et jitter).

## 🤖 A-07 — Plan de reprise

- `backup.sh` à 3 h chaque nuit : dumps `mtc_prod_*_auto.sql.gz` (~4,8 Mo), rétention 14 jours,
  121 Mo au total dans `/opt/backups/mtc/`.
- `backup-apps.sh` le dimanche à 22 h 45.
- **Aucune commande d'envoi hors du VPS** dans les deux scripts.
- Restauration déjà testée : **à confirmer par l'humain** (aucune trace dans les scripts).

**Conséquence :** SCA-B7-09 (copie chiffrée hors-site + restauration testée) confirmé.
