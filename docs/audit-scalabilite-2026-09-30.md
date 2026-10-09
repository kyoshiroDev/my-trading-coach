# Audit de scalabilité — 1 000 → 10 000 utilisateurs (30 septembre 2026)

> **Passe d'audit, lecture seule : rien n'a été corrigé.** Contexte : référencement dans
> l'écosystème NinjaTrader (~800 000 traders exposés). Question : l'app encaisse-t-elle une
> vague de 1 000, 2 000… jusqu'à 10 000 utilisateurs ?
>
> Sources : lecture du code (API, schéma Prisma, front Angular, landing, CI/CD) + mesures VPS
> réelles de `docs/pre-launch-checklist-newsletter-2026-09-30.md`. **Aucun test de charge n'a
> jamais été exécuté** : les seuils ci-dessous sont des estimations raisonnées, pas des mesures.

---

## 1. Verdict

| Palier (inscrits) | Actifs simultanés au pic (~10 %) | État actuel | Après P0 (config, ~1 j) | Après P0 + P1 (code, ~1–2 sem.) |
|---|---|---|---|---|
| **1 000** | ~100 | 🟠 passe, mais un pic d'inscriptions ou 3 PDF simultanés peuvent faire tomber l'API (OOM) | ✅ | ✅ |
| **2 000** | ~200 | 🔴 OOM probable au pic ; e-mails perdus (Resend) ; pool Postgres saturable | 🟠 passe si peu de gros imports | ✅ |
| **5 000** | ~500 | 🔴 CPU Node saturé (analytics en JS), cron Tradovate qui se chevauche | 🔴 | ✅ avec prod isolée de dev/beta |
| **10 000** | ~1 000 | 🔴 | 🔴 | 🟠 tient sur **un** VPS dédié à la prod (8 vCPU / 16 Go conseillés), crons dans un conteneur séparé |

**En une phrase :** la machine n'est pas le problème (4 vCPU, 7,7 Go, charge 0,05). Le
goulot, c'est **un conteneur API de 1 Gio déjà rempli à 58 % au repos**, dans lequel plusieurs
opérations gourmandes (argon2, Chromium, parsing xlsx) peuvent exploser la mémoire. Viennent
ensuite des **calculs qui relisent tout l'historique de trades** à chaque affichage et chaque
écriture. Le schéma de base est sain ; ce sont les usages qui ne passent pas à l'échelle.

**Ordre de rupture attendu :**
1. Pic d'inscriptions/connexions → OOM du conteneur (argon2 + Chromium) → **coupure totale** de l'API.
2. 2k–5k : CPU Node saturé par les agrégats analytics, Redis bloqué par `KEYS`, pool Postgres.
3. ~5k : les crons (Tradovate, récap quotidien, e-mails) ne tiennent plus leur fenêtre.

---

## 2. Infra & VPS (mesuré le 29–30/09)

| Élément | Valeur | Commentaire |
|---|---|---|
| VPS OVH | 4 vCPU, 7,7 Go RAM (2,7 utilisés), 41 Go libres | Largement sous-utilisé |
| `mtc_api_prod` | **587 Mo / 1 Gio au repos**, 1 primaire + 4 workers | Pas de `--max-old-space-size`, pas de swap (`memswap_limit = mem_limit`) |
| `mtc_api_beta` | 610 Mo | Sur la même machine, en concurrence avec la prod |
| Postgres | `max_connections = 50` | Partagé prod / dev / beta |
| PgBouncer | transaction, pool 25 **par base** × 3 = 75 | **> 50** : incohérent |
| Redis | partagé prod / dev / beta, **sans préfixe ni `db` distinct dans le code** | À vérifier sur le VPS (voir 🔴 C6) |
| Sauvegardes | quotidiennes, **sur le même VPS** | Aucune copie hors-site |
| Monitoring / Sentry | absent | Une panne n'est vue que si un utilisateur écrit |

---

## 3. Constats CRITIQUES — cassent avant ~2 000 utilisateurs

### C1. Mémoire de l'API : un seul conteneur, sans plafond de tas
`main.ts:102` — `availableParallelism()` sans borne, `docker-compose.prod.yml:13` 1 Gio.
Au moindre pic, l'OOM killer frappe ; au-delà de 5 morts/min (`main.ts:115`) le conteneur
entier redémarre, migrations comprises (10–40 s de 502). Un passage à un VPS 8 cœurs lancerait
8 workers ≈ 1,05 Go **au repos** → crash immédiat.
**Fix :** `WEB_CONCURRENCY` lu dans `main.ts` (3 pour commencer), `NODE_OPTIONS=--max-old-space-size=256`,
`mem_limit: 2g`, arrêter `mtc_api_beta`/`mtc_api_dev` pendant la fenêtre de lancement.

### C2. argon2 avec les paramètres par défaut (64 Mio par hash)
`auth/auth.service.ts:86,169,254`. 4 threads libuv × 4 workers × 64 Mio = jusqu'à **1 Gio de
mémoire temporaire**. Environ 7 connexions/inscriptions simultanées suffisent à dépasser la
marge de ~430 Mo.
**Fix :** `{ memoryCost: 19456, timeCost: 2, parallelism: 1 }` (minimum OWASP) — les anciens
hashs restent vérifiables, rehash à la connexion suivante.

### C3. Un Chromium lancé par PDF
`pdf/pdf.service.ts:46` (`puppeteer.launch` à chaque requête, depuis `debrief.controller.ts:39`).
150–300 Mo par instance, aucune limite de concurrence ni timeout. 3–4 téléchargements
simultanés (lundi matin après l'e-mail de débrief) = OOM.
**Fix :** un navigateur réutilisé + file de concurrence 1–2 + timeout `page.pdf` + cache du PDF
par (user, semaine). Idéalement dans un conteneur séparé.
*(Au passage : les templates injectent du texte IA/utilisateur sans échappement, `pdf.service.ts:81-110`.)*

### C4. Limite d'inscription contournable
`common/throttler/email-aware-throttler.guard.ts:25` : la clé est `IP:empreinte-email`, donc
les limites de `register` (5/min) et `forgot-password` (3/min) s'appliquent **par adresse**.
Une IP qui change d'e-mail s'inscrit sans limite → hash argon2 (C2) + 2 e-mails Resend par
inscription (`auth.service.ts:144,151`, dont une alerte admin).
**Fix :** ajouter un second compteur **IP seule** (ex. 10 inscriptions/h/IP) ; remplacer
l'alerte admin par inscription par un digest quotidien.

### C5. Connexions Postgres sur-allouées
`prisma/prisma.service.ts:23` : `max: 10` par worker (commentaire « limite PG 100 » faux).
Avec `@prisma/adapter-pg`, `?connection_limit=1` dans l'URL est **ignoré**. PgBouncer : 3 × 25
= 75 connexions serveur pour `max_connections = 50`. Sous charge, prod + beta épuisent Postgres
et les migrations/admin échouent.
**Fix (config) :** pool prod ≈ 25, dev/beta ≈ 5 chacun (ou `max_connections = 100`) ; `max: 5`
par worker + `connectionTimeoutMillis: 5000`.

### C6. Redis probablement partagé entre prod, dev et beta sans séparation de clés — **à vérifier en priorité**
Aucun `db`, `keyPrefix` ni `prefix` BullMQ dans `infra/redis.service.ts:11`, `app.module.ts:58`,
`redis-io.adapter.ts:34`. Si les trois environnements pointent sur la même base Redis :
les workers **dev/beta consomment les jobs `stripe` et `debrief` de la prod** (webhooks Stripe
traités contre la mauvaise base), les broadcasts socket se mélangent, les compteurs de rate
limit et quotas IA sont communs. Les jobs en échec sont gardés indéfiniment
(`removeOnFail: false`) alors que Redis peut être en `noeviction`.
**Vérifier :** `REDIS_URL` / `REDIS_DB` dans `.env.production`, `.env.dev`, `.env.beta` ;
`redis-cli INFO memory` et `CONFIG GET maxmemory*`.
**Fix :** un `db` ou `keyPrefix` + `prefix` BullMQ par environnement ; `removeOnFail: { age: 7 j }` ;
`maxmemory` 256–512 Mo.

### C7. Import de trades ligne par ligne + `KEYS` Redis à chaque ligne
`trades/trades.service.ts:221` appelle `create()` par ligne (5–6 allers-retours DB chacun), et
chaque `create()` appelle `invalidateUserCache` → `redis.keys('analytics:<uid>:*')`
(`analytics/analytics.service.ts:40`). `KEYS` est O(taille totale de Redis) et **bloque Redis
pour tout le monde** (rate limit, sockets, BullMQ). Un CSV de 5 000 lignes ou un backfill
Tradovate = ~30 000 allers-retours DB + 5 000 `KEYS` → 30–90 s de requête HTTP.
La ligne 182 recharge aussi tous les trades de l'utilisateur pour la déduplication, même
quand il n'y a rien à importer (cas normal de chaque sync Tradovate toutes les 15 min).
**Fix :** résoudre setup/session/compte une fois par lot, `createMany({ skipDuplicates: true })`
par tranches de 500 (la contrainte `@@unique([userId, importHash])` existe déjà), invalider le
cache une seule fois via un **compteur de version** (`analytics:v:<uid>` + `INCR`) au lieu de
`KEYS`, sortie immédiate si `dtos.length === 0`.

### C8. Le tableau de bord recalcule tout l'historique en JavaScript
`analytics/analytics.service.ts:97, 211, 254, 290, 321, 357, 484` : 7 requêtes sans `take` qui
chargent **tous** les trades clos, agrégés en Node. Le cache de 5 min est vidé à chaque écriture,
donc aussi à chaque sync live Tradovate. Idem `trades.service.ts:293` (stats du journal, à
chaque filtre) et `accounts/accounts.service.ts:74` (sélecteur de comptes, sans cache).
À 3 000 trades/user : 50–150 ms de CPU bloquant par affichage. Les scalpers NinjaTrader
dépassent facilement 10 000 trades. **C'est ce qui sature les 4 vCPU vers 500 actifs.**
**Fix :** agrégation SQL (`SUM`, `COUNT FILTER`, `date_trunc('day' … AT TIME ZONE 'Europe/Paris')`,
`SUM() OVER` pour l'equity/drawdown) ; index `(accountId, tradedAt)`.

### C9. Déploiement = coupure, sans rollback
`.github/workflows/cd.yml:46-68` : build de l'image **sur le VPS de prod** (pnpm install + nx build
sur les mêmes 4 vCPU), puis `up --force-recreate` du seul conteneur, migrations au démarrage.
L'image est toujours `:latest` : pas de retour arrière. Et `deploy-api` n'a pas de filtre
`affected` : **tout** commit sur `main` (même landing seule) redéploie l'API.
Chaque déploiement provoque 10–40 s de 502 puis une tempête de reconnexions (sockets +
reconnexion Tradovate de chaque utilisateur live).
**Fix immédiat :** gel des déploiements API pendant la fenêtre de lancement, filtre `affected`.
**Ensuite :** image construite en CI et taguée par SHA (GHCR), migration en one-shot, health
gate sur `/api/health/ready` avec retour au SHA précédent.

### C10. Sauvegardes uniquement sur le VPS qu'elles protègent
Perte du disque ou du VPS = perte définitive des données de milliers de traders.
**Fix :** `restic`/`rclone` nocturne vers OVH Object Storage ou Backblaze B2, plus une
restauration testée une fois.

---

## 4. Constats HAUTS — cassent entre 2 000 et 10 000

| # | Constat | Où | Fix |
|---|---|---|---|
| H1 | **Polling front** : `/auth/me` toutes les 30 s même onglet caché ; en session : stats 30 s, contexte marché 15 s, éco 60 s ; quick-trade : prix toutes les 4 s. ≈ 9 req/min/onglet, 24 avec quick-trade → **75–200 req/s rien qu'en polling pour 500 actifs** | `app/core/auth/auth.service.ts:71`, `core/stores/session.store.ts:93-124`, `core/constants/polling.const.ts` | Pause si `document.hidden` ; contexte marché et éco poussés par le socket `/eco` existant ; `/me` toutes les 5 min |
| H2 | **Chaque requête authentifiée** = 1 `user.findUnique` + 1 EVAL Redis + 1 SETNX ; `PresenceInterceptor` écrit `lastSeenAt` 1×/min **par worker** (Map en mémoire locale) | `auth/jwt.strategy.ts:21`, `common/interceptors/presence.interceptor.ts:14` | Cache du user JWT 30–60 s ; présence via Redis `SET NX EX 60` |
| H3 | **Rate limit 60/min par IP** : pénalise des traders derrière une même IP (bureaux, CGNAT mobile) une fois connectés | throttler global | Clé = userId sur les routes authentifiées |
| H4 | **Récap quotidien** : `Promise.all` sur tous les Premium ayant tradé → N appels Anthropic + N envois Resend **simultanés**. Resend ≈ 2–10 req/s, les 429 sont journalisés puis **perdus** | `daily-recap/daily-recap.cron.ts:35`, `resend/resend.cron.ts:36`, `resend.service.ts:268` | File BullMQ comme `debrief.cron.ts`, concurrence 3–5, limiter Resend + retry |
| H5 | **Cron Tradovate** séquentiel, sans verrou anti-chevauchement : 500–1 000 connexions × 2–5 s = 20–80 min pour une période de 15 min → passes empilées | `integrations/tradovate/tradovate-background-refresh.cron.ts:56,97` | Verrou Redis « passe en cours », p-limit 5–10 ou 1 job BullMQ par connexion |
| H6 | **Regrade comportemental** : chaque écriture de trade relit tout le compte et peut lancer des milliers d'`UPDATE` dans une transaction | `trades/behavioral-grades.ts:14-84` | Asynchrone (BullMQ, debounce par compte), fenêtre limitée, `UPDATE … FROM (VALUES …)` |
| H7 | **Worker cron = worker HTTP** : crons, imports, BullMQ tournent dans des process qui servent aussi le trafic → pics de latence | `main.ts:137`, `app.module.ts:67`, `debrief.processor.ts:9` | Conteneur `worker` séparé (même image, `IS_CRON_WORKER=true`, pas de route Traefik) |
| H8 | **Parsing xlsx synchrone** sur l'event loop, ouvert aux FREE (5 Mo compressés → centaines de Mo) | `trades/csv-import.service.ts:421` | `worker_thread`/piscina + timeout, `sheetRows`, limite 5 imports/min |
| H9 | **Temps réel Tradovate** : 1 WebSocket sortant par connexion live + heartbeat 2,5 s + renouvellement de bail 10 s ; reconnexion massive à chaque déploiement. Limites Tradovate par vendor/IP inconnues | `tradovate-live.service.ts:19,106-119,223`, `tradovate-live.protocol.ts:18` | Jitter côté client, p-limit sur `catchUp`, vérifier les quotas Tradovate |
| H10 | **Sockets `/eco` non authentifiés et illimités**, chaque connexion journalisée au niveau `log` | `eco-calendar/eco-calendar.gateway.ts:12,29-34` | Auth sur `/eco`, logs en `debug`, `maxHttpBufferSize` |
| H11 | **Appels IA** synchrones sans sémaphore global ; quota mensuel check-then-increment non atomique | `ai/ai.service.ts:543-576` | Sémaphore Redis, `INCR` puis comparaison |

## 5. Constats MOYENS

- `fetch()` sans timeout dans le chemin requête (`trades/market-data.service.ts:114,232,253…`,
  `eco-calendar.service.ts:55`) → jusqu'à 300 s d'attente ; pas de single-flight sur les caches
  de prix (TTL 3 s) ni sur `ensureNewsTextFr` (N utilisateurs = N appels IA). `AbortSignal.timeout(5000)` + verrou Redis.
- Tableau de bord Angular : 10–20 requêtes à l'ouverture pour ~8 utiles (rechargements en
  cascade `knownTradesCount`/`knownAccountsCount`, `dashboard.component.ts:201-222,358-396`).
- `withPreloading(PreloadAllModules)` (`app.config.ts:34`) télécharge tous les chunks après login.
- Landing : un `fetch('/public/stats')` par visite (`index.astro:140`) — 800 k impressions
  = autant d'appels Node. Ajouter `Cache-Control: public, max-age=300` et le cacher côté nginx.
- rsync `--delete` non atomique (`cd.yml:118,165,208`) → `ChunkLoadError` pour les onglets ouverts.
- Tables sans rétention : `AiUsageLog` (~1–2 M lignes/an à 10 k), `EmailSend`, `StripeEvent`,
  `MarketNews`, `UserDailyActivity`.
- Index : ajouter `Trade(accountId, tradedAt)`, `User(isDemo, lastSeenAt)`, `User(createdAt)` ;
  supprimer les `@@index` redondants avec un `@@unique` (DailyRecap, UserDailyActivity,
  EcoCalendarCache, EcoAnalysisCache, MetricsSnapshot).
- `auto-campaigns.cron.ts:36-55` : N+1 (~20 000 requêtes/run à 10 k users) → une requête `NOT EXISTS` par campagne.
- `debrief.cron.ts:42` journalise tous les e-mails éligibles sur une ligne (PII + volume).
- Healthcheck Docker sur `/api/health` (liveness) et non `/api/health/ready`.
- `rawBody: true` global (`main.ts:30`) alors que seul Stripe en a besoin.
- `deploy.sh` à la racine est obsolète (référence un service `nginx` inexistant) : à supprimer.

## 6. Ce qui est déjà bien

- Schéma Prisma propre, index `(userId, tradedAt)` en place, contraintes d'unicité pour l'import.
- Aucune `$transaction` interactive (compatible PgBouncer transaction), un seul `$queryRaw`, paramétré.
- Rate limiting stocké dans Redis (atomique, partagé entre workers), `trust proxy` correct.
- Adaptateur Redis socket.io + transport `websocket` forcé → pas besoin de sticky sessions.
- Webhooks Stripe et débriefs hebdo déjà en file BullMQ.
- Toutes les routes IA sont réservées au Premium ; l'IA « mutualisée » FREE est en cache 12 h → coût IA FREE quasi nul.
- Tous les crons ciblant des users excluent `isDemo`.
- Fronts 100 % statiques (Angular, landing Astro `output: 'static'`), routes lazy, hash de fichiers.
- Sentry à `tracesSampleRate: 0` (pas de surcoût).

---

## 7. Plan d'action

### P0 — avant la mise en avant NinjaTrader (config + petits correctifs, ~1 jour)
1. **Vérifier l'isolation Redis** prod / dev / beta (C6). Si partagée : `db` ou préfixe distinct *aujourd'hui*.
2. `WEB_CONCURRENCY=3`, `NODE_OPTIONS=--max-old-space-size=256`, `mem_limit: 2g` ; arrêter beta et dev pendant le lancement (C1).
3. Paramètres argon2 OWASP (C2) + limiteur IP seule sur register/forgot (C4).
4. PDF : un seul Chromium réutilisé + concurrence 1 + timeout (C3).
5. PgBouncer : pools prod 25 / dev 5 / beta 5, `max: 5` par worker (C5).
6. Gel des déploiements API + filtre `affected` sur `deploy-api` (C9).
7. Sauvegarde hors-site + une restauration testée (C10).
8. Activer Sentry (DSN) et une alerte uptime externe (UptimeRobot / Better Stack) sur `/api/health/ready`.
9. **Vérifier le plan Resend** : le gratuit est limité à 100 e-mails/jour. 2 e-mails par inscription
   → **plafond à ~50 inscriptions/jour**, le reste perdu en silence.
10. Test de charge k6 sur **beta** (register, login, dashboard, `/auth/me`, `/public/stats`),
    montée à 200 VU, en surveillant `docker stats`.

### P1 — pendant les 2 premières semaines (code, pour tenir 2 k → 10 k)
1. Import en `createMany` par lots + cache versionné sans `KEYS` (C7).
2. Agrégation SQL pour dashboard, journal, comptes (C8) + index `(accountId, tradedAt)`.
3. Polling front : pause en onglet caché, données partagées via socket, `/me` à 5 min (H1).
4. Cache du user JWT, présence via Redis, rate limit par userId une fois connecté (H2, H3).
5. Récap quotidien et e-mails en BullMQ avec limiteur (H4) ; cron Tradovate verrouillé et parallélisé (H5).
6. Regrade comportemental asynchrone (H6) ; parsing xlsx hors event loop (H8).

### P2 — avant 5 000–10 000 inscrits (architecture)
1. Conteneur `worker` séparé pour crons + BullMQ + Tradovate live (H7, H9).
2. **Sortir dev et beta du VPS de prod** (ou au minimum leurs bases/Redis). Prod seule sur 8 vCPU / 16 Go.
3. Déploiement sans coupure : image GHCR taguée par SHA, 2 réplicas API derrière Traefik, migration en one-shot, rollback.
4. Rétention des tables de log, nettoyage des index redondants.

---

## 8. Hypothèses et inconnues

- **Aucune mesure sous charge** : les seuils (OOM à ~7 hashs simultanés, saturation CPU à ~500 actifs) sont des estimations à confirmer par k6 sur beta.
- 10 % d'inscrits actifs simultanément au pic, quelques milliers de trades par utilisateur actif.
- Non vérifiable depuis le dépôt : config nginx (cache, gzip), config Redis de prod, plan Resend, quotas Tradovate par vendor/IP.
- Conversion réaliste d'une exposition à 800 k traders : quelques milliers d'inscriptions, concentrées sur les 24–72 premières heures. **C'est ce pic d'inscriptions, plus que le total, qu'il faut encaisser** (d'où la priorité donnée à C1–C4).
