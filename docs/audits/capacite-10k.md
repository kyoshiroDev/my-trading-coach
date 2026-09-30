# Audit de capacité — l'architecture cible tient-elle 10 000 utilisateurs ? (PROMPT-136)

> Audit en **lecture seule** réalisé le 30/09/2026 sur la branche `beta` (commit `d929a68`).
> Aucun fichier de code, de config, de conteneur ni de base n'a été modifié. Seuls ajouts : ce
> rapport et les outils de test de charge `tools/load-tests/` (non branchés à la CI).
> Aucun appel réel à Anthropic, Tradovate, Stripe (LIVE ou test), Resend, FMP ou Yahoo.
>
> Convention : **[M]** = mesuré pendant l'audit · **[E]** = estimé (calcul ou lecture du code, raisonnement donné).

---

## 1. Verdict

**Oui, sous conditions.** En l'état, le code ne tient pas 1 000 utilisateurs simultanés, même sur
le VPS-3 : sur une réplique à 4 vCPU chargée avec 10 000 users et 2,2 M de trades, le premier seuil
casse à **500 simultanés [M]** (lecture p95 = 700 ms). Sur le VPS-3 en l'état, on peut compter sur
**≈ 500–650 simultanés [E]**, et ce plafond baisse à mesure que la table `Trade` grossit. Mais la
cause est concentrée sur **deux requêtes Prisma `_count`**, qui représentent 99 % du temps DB.
Une fois leur coût neutralisé, la même machine à 4 vCPU a tenu **1 000 simultanés avec lecture
p95 = 24 ms, écriture p95 = 74 ms et 0 % d'erreurs [M]**. Le VPS-3 garde alors une marge ×2 **[E]**.

Trois conditions pour y arriver :
1. Les correctifs **P0** du §7.1, tous d'effort S.
2. Plafonner la mémoire et le nombre de workers de l'API avant la migration.
3. Refondre la **synchro Tradovate** (P1-4 à P1-6) avant ~300 connexions broker. Elle n'a pas pu être testée en charge ; c'est le premier risque hors HTTP.

---

## 2. Goulots classés (du plus bloquant au moins bloquant)

| # | Composant | Symptôme à 10 k | Seuil de rupture estimé (simultanés) | Sévérité | Effort |
|---|---|---|---|---|---|
| 1 | **Prisma `_count` sur `Trade`**, dans `GET /setups` et `GET /session/active` | Chaque appel lance un `GROUP BY` sur **toute** la table Trade. Mesuré : 0,37 à 2 s par appel à vide, 1,37 s de moyenne sous charge, **≈ 99 % du temps DB total**, jusqu'à ~3,5 cœurs Postgres en scans parallèles **[M]** | **500 [M]** sur 4 vCPU → ~500–650 sur le VPS-3 **[E]**. Le seuil **baisse** à mesure que Trade grossit (O(trades de tous les users)) | **Bloquant** | S |
| 2 | **Synchro Tradovate** : cron séquentiel toutes les 15 min, resynchro REST complète à chaque fill, aucun disjoncteur, pénalités non détectées | Passages de cron qui se chevauchent. Copy-traders en 429 (1 h de blocage). ~180 k req/h sortantes depuis une seule IP. Trous d'historique silencieux | ~300 connexions pour le cron **[E]**. 429 dès 1 copy-trader actif, **quel que soit le volume [E]** | **Bloquant** | M–L |
| 3 | **Mémoire de l'API**. `mem_limit: 1g`, pas de plafond de tas, workers = `availableParallelism()` (6 sur le VPS-3) | PSS mesurée localement, sans plafond : 1,0 Go à 100 VU, 1,3 Go à 250, **2,0–2,4 Go à 1 000 [M]**. En prod, ~590 Mo sans aucun trafic [M, 30/09]. Un dépassement fait tuer tout le conteneur (tous les workers) par l'OOM killer | ~150–300 **[E]** : V8 collecte plus tôt dans un cgroup de 1 Go, et la mesure locale surestime. À confirmer en dev | **Bloquant** (risque) | S |
| 4 | **Import ligne à ligne** (`importTrades`) + `KEYS` Redis, appelé par le CSV **et à chaque synchro Tradovate** | ~5 ms et ~6 requêtes par ligne. 2 000 lignes = 11,5 s, 10 000 lignes = **52 s dans une seule requête HTTP [M]**. Charge DB proportionnelle au nombre de connexions broker | 100 connexions/h le jour d'une campagne **[E]** | **Bloquant** | M |
| 5 | **Crons « tout en même temps »** : `Promise.all` du recap, campagnes dans une requête HTTP, debrief en concurrency 1 | Rafale de 300–1 000 appels Sonnet + Resend à 17h30, emails perdus sans trace. Debrief ~12 h. Campagne admin ~67 min dans une requête | ~300 PREMIUM actifs **[E]** | **Bloquant** | S–M |
| 6 | **Login argon2id** (m = 64 Mo, t = 3, p = 4) dans le threadpool libuv (4 threads/worker) | 270 ms à froid. **1,25 s de médiane dès 100 VU**, 24 s à 500 et timeouts à 1 000 quand les logins s'enchaînent (passage A). 64 Mo par vérification **[M]** | ~10–20 logins/s sur 4 cœurs **[E d'après M]**. Rarement atteint si les users gardent leur refresh token (passage B : 10 % de logins, pas de tempête ; passage C : login p95 183 ms à 1 000 VU) | À surveiller | S |
| 7 | **Calendrier éco** : broadcast, ruée `refresh-today` + `analyze-result`, IA non mutualisée, FMP appelé sur le chemin user les jours vides | 4–6 k requêtes en ~1 s à chaque publication, appels Haiku en double, coût IA O(users) | ~500–1 000 connectés **[E, non testé]** | À surveiller → Bloquant | M |
| 8 | **Analytics agrégés en JS** + cache inopérant (`to` à la ms) | 8 000 lignes par endpoint pour un gros trader, jusqu'à 155 ms à froid **[M]**. Sans impact visible dans le passage C (p95 28 ms à 1 000 VU), car les gros traders sont rares | > 1 000 **[E]**. Dépend de la part de gros traders | À surveiller | M |
| 9 | **Rate limiting par IP** (60/min) | Un user avec la saisie rapide fait ~25 req/min : 3 onglets ou collègues derrière un même NAT (prop firm) prennent des 429 | Dépend des NAT, pas de la charge | À surveiller | S |
| 10 | **Pool et connexions Postgres** | 41 connexions ouvertes au plus, 25 actives au pire moment (passage B), 2 après correctif (passage C) **[M]**. `max_connections = 50` en prod pour 3 bases | OK sur le VPS-3 dédié avec la config §5 | OK | S |
| 11 | **Redis** | 3–7 Mo utilisés à 1 000 VU **[M]**. Files BullMQ vides pendant le test | OK. `noeviction` et `maxmemory` à poser | OK | S |
| 12 | **Réseau** | ~0,5 Mo/s de réponses API à 1 000 VU **[M, non compressé]**. Assets : 106 Ko au premier chargement **[M]** | ≪ 2 Gbit/s | OK | – |
| 13 | **Disque** | Base ≈ 1 Go pour 2,2 M trades **[M]**, 5–9 Go à 1 an **[E]**, ≈ 30–35 Go au total | ≫ 10 k | OK | – |

---

## 3. Résultats des tests de charge

### 3.1 Protocole

- **Cible** : une réplique locale de l'environnement dev (voir §9 pour la raison). 4 vCPU,
  PostgreSQL 16, Redis 7, API buildée en production, lancée avec `NODE_ENV=production` et un
  cluster de 4 workers **comme en prod**. Aucun appel sortant : `AI_ENABLED=false`, pas de clé FMP,
  cache marché pré-rempli, clés Stripe et Resend factices, aucune connexion Tradovate.
- **Données** : 10 000 users et 2 232 050 trades (seed `tools/load-tests/seed`).
- **Scénario** (`tools/load-tests/k6/us-open.js`). Chaque VU est un trader connecté avec une session
  ACTIVE. Au démarrage, il charge le dashboard (8 appels). Ensuite il reproduit le polling réel du
  front :
  - `live-price` toutes les 4 s (60 % des VU) ;
  - `market/context` toutes les 15 s ;
  - `today/stats` et `auth/me` toutes les 30 s ;
  - `eco range` et `pins` toutes les 60 s.

  Une navigation par minute s'y ajoute : journal + stats 30 %, saisie d'un trade 20 %, dashboard
  15 %, analytics 10 %, comptes 10 %, setups 5 %. Cela représente **~0,35 req/s par user
  [M]**, donc **~350 req/s à tenir pour 1 000 simultanés**.
- **Paliers** : 100, 250, 500 et 1 000 VU, 1 min de montée puis 5 min de plateau. Seules les
  requêtes des plateaux sont comptées.
- **Seuils** : lecture p95 < 500 ms, écriture p95 < 1 s, erreurs < 0,5 %.
- **Trois passages** :
  - **A — « tout le monde se logue »** : chaque VU fait un vrai login argon2 à son arrivée, et se
    reconnecte après un 401 ou un échec. C'est le pire cas pour l'authentification.
  - **B — « réaliste »** : 90 % des VU arrivent avec une session déjà ouverte (JWT signé avec le
    secret de l'environnement de test, l'équivalent d'un `/auth/refresh`). 10 % font un vrai login.
  - **C — « après P0-1 »** : même scénario que B, mais sans `GET /setups` ni `GET /session/active`
    (option `EXCLUDE`). Cela simule le correctif des requêtes `_count` **sans toucher au code**.
    Paliers 500 et 1 000, plateaux de 3 min.

### 3.2 Résultats par palier [M]

| Passage | Palier (VU) | Débit (req/s) | Lecture p50 / p95 / p99 (ms) | Écriture p50 / p95 / p99 (ms) | Erreurs | Seuils |
|---|---|---|---|---|---|---|
| A | 100 | 34 | 6 / **364** / 782 | 18 / **1 101** / 1 407 | 0 % | lecture ✅ écriture ❌ (logins à 1,25 s) |
| A | 250 | 79 | 6 / **2 207** / 5 533 | 20 / 2 122 / 12 228 | 0 % | ❌ |
| A | 500 | 125 | 52 / 8 684 / 22 281 | 239 / 29 193 / 54 258 | 0,28 % | ❌ |
| A | 1 000 | **102** (le débit s'effondre) | 2 145 / 59 477 / 60 001 | 60 000 / 60 001 / 60 003 | **12,7 %** (logins à 96,5 % en timeout) | ❌ |
| **B** | 100 | 35 | 6 / 15 / 41 | 20 / 29 / 40 | 0 % | ✅ |
| **B** | 250 | 87 | 6 / 31 / 336 | 21 / 59 / 989 | 0 % | ✅ |
| **B** | **500** | 168 | 9 / **700** / 6 795 | 24 / 811 / 18 750 | 0,02 % | **❌ premier seuil cassé : lecture p95** |
| **B** | 1 000 | 241 (la demande est à ~350) | 45 / 10 932 / 32 749 | 96 / 43 630 / 60 001 | 0,04 % | ❌ |
| **C** | 500 | 173 | 6 / 14 / 22 | 20 / 41 / 118 | 0 % | ✅ |
| **C** | **1 000** | **346** | 7 / **24** / 40 | 26 / **74** / 128 | **0 %** | ✅ |

**Endpoints qui cassent en premier** (passage B, p95 en ms) :

| Endpoint | 250 VU | 500 VU | 1 000 VU |
|---|---|---|---|
| `GET /setups` (`_count`) | – | **10 195** (p50 514) | 39 640 (p50 **20 154**) |
| `GET /session/active` (`_count`) | – | **7 437** | 14 110 |
| `GET /analytics/summary` | – | 8 042 | 30 993 |
| `GET /market/live-price` (Redis seul) | – | 177 | 1 909 |
| `GET /auth/me` | – | 470 | 16 761 |
| `POST /trades` | – | 352 | 13 250 |

Au passage C, à 1 000 VU, les mêmes endpoints restent sous 70 ms : `analytics/summary` p95 28 ms,
`auth/me` 18 ms, `live-price` 27 ms, `POST /trades` 67 ms.

### 3.3 Ressources par palier [M]

Mesures du script `monitor.sh`. CPU en % d'un cœur (100 = 1 cœur). Mémoire en **PSS**, c'est-à-dire
la mémoire partagée comptée une seule fois. Il n'y a pas de Docker dans l'environnement d'audit :
les mesures sont faites par groupe de process, pas avec `docker stats`. Pour Postgres, le CPU est
échantillonné sur des backends éphémères : on donne la médiane et le pic.

| Passage / VU | API CPU (méd. / pic) | API mémoire (PSS) | Postgres CPU (méd. / pic) | Connexions PG (ouvertes / actives max) | Redis | k6 (même machine) | Load 1 min |
|---|---|---|---|---|---|---|---|
| A / 100 | 57 / 132 % | 1,1–1,4 Go | 12 / 115 % | 41 / 3 | 3 Mo | 10 % | 2,8 |
| A / 500 | 123 / 224 % | 2,3–2,8 Go | 49 / 286 % | 41 / 21 | 5 Mo | 24 % | 15,8 |
| A / 1 000 | **307 / 375 %** | 2,6–3,0 Go | 47 / 136 % | 41 / 4 | 5 Mo | 17 % | **41,7** (threads argon2) |
| B / 100 | 24 / 49 % | 1,0 Go | 4 / 25 % | 29 / 2 | 3 Mo | 6 % | 1,5 |
| B / 250 | 53 / 93 % | 1,3 Go | – / 62 % | 41 / 2 | 3 Mo | 13 % | 3,2 |
| B / 500 | 77 / 162 % | 1,7–1,9 Go | 41 / **255 %** | 41 / 6 | 4 Mo | 17 % | 5,8 |
| B / 1 000 | 98 / 229 % | 2,2–2,4 Go | 122 / **347 %** | **41 / 25** | 6 Mo | 22 % | 12,7 |
| C / 500 | 78 / 126 % | 1,3 Go | 16 / 22 % | 37 / 2 | 5 Mo | 17 % | 1,6 |
| C / 1 000 | **144 / 171 %** | **2,0 Go** | **31 / 38 %** | 41 / 2 | 7 Mo | 29 % | 2,9 |

Temps DB cumulé par requête (`pg_stat_statements`) sur le passage B complet (25 min) :

| Requête | Appels | Moyenne | Temps total |
|---|---|---|---|
| `Setup` + `_count` (GROUP BY Trade complet) | 1 415 | **1 371 ms** | **1 939 s** |
| `TradeSession` + `_count` | 2 206 | 129 ms | 285 s |
| `User` par PK (JWT, 1 par requête) | 206 861 | 0,03 ms | 6 s |
| Tout le reste | | | < 10 s |

**Lecture.**
- **Passage B.** La rupture vient de **Postgres** : scans séquentiels parallèles de 2,2 M de lignes,
  3,5 cœurs en pointe. Les connexions du pool restent occupées par ces requêtes et **toutes** les
  autres requêtes attendent leur tour, y compris celles qui ne touchent que Redis (`live-price`).
- **Passage A.** S'y ajoute la **saturation CPU de Node** par argon2 : 4 threads libuv par worker,
  64 Mo par hash. Ces threads partagent le threadpool avec zlib (`compression()`), ce qui est une
  hypothèse cohérente avec la load à 42.
- **Passage C.** Sans ces deux requêtes, l'API n'utilise plus qu'**~1,45 cœur pour 346 req/s**
  (≈ 4 ms de CPU par requête) et Postgres 0,3 cœur.

### 3.4 Extrapolation vers le VPS-3 [E]

- **Machine d'audit** : 4 vCPU, dont ~0,2–0,3 pris par k6, soit ≈ 3,7 cœurs pour la stack.
  **VPS-3** : 6 vCores, soit ≈ 1,6× plus de CPU disponible, NVMe, et pas de beta/dev à côté.
  La génération exacte des CPU OVH n'est pas connue : aucun gain par cœur n'est supposé.
- **Code en l'état.** La ressource saturée est le CPU de Postgres. Elle croît en O(trades totaux) ×
  (appels à `/setups` + `/session/active`). Avec 1,6× plus de CPU, la rupture passerait de 500 à
  **~650 VU au mieux** au volume de 2,2 M de trades, puis redescendrait avec la croissance de la
  table (à 4 M de trades, le coût par appel double). **Verdict : 1 000 simultanés non tenus**.
- **Après P0-1** (passage C). À 1 000 VU, la stack consomme ~1,45 cœur d'API, 0,3 de Postgres et
  < 0,1 de Redis. Sur le VPS-3, avec 4 workers API et un plafond de ~3,5 cœurs, la saturation
  linéaire arriverait vers **~2 000–2 400 simultanés**. Un objectif d'utilisation de 70 % donne
  **~1 700**. La marge ×2 demandée sur le pic de 450 est tenue, et même la marge sur 1 000.
  Cette extrapolation **n'inclut pas** :
  - le coût de la synchro Tradovate (`importTrades` à chaque fill, ~1 800 WebSockets) ;
  - la ruée du broadcast éco ;
  - les crons de 17h30 ;
  - Traefik et TLS : ~0,2–0,4 cœur **[E]**.

  Ces charges justifient le conteneur worker séparé (P2-1) et les correctifs P1.
- **Mémoire.** L'API atteint ~2,0 Go de PSS à 1 000 VU **[M]** sans plafond de tas. Sur le VPS-3,
  poser `mem_limit: 2g` minimum avec `--max-old-space-size=384` et 4 workers, puis **vérifier en
  dev** qu'il n'y a pas d'OOM. Le budget du §4 réserve 3 Go par prudence.

### 3.5 Import CSV [M]

| Fichier | Résultat | Temps | Mémoire API |
|---|---|---|---|
| 5,29 Mo (46 000 lignes Tradovate) | 413 « File too large » | 0,04 s | – |
| 4,83 Mo (42 000 lignes) | 400 « Maximum 10000 par import », après parsing complet | **0,55 s** | +56 Mo en pointe |
| 2 000 lignes | 201, 2 000 créées | **11,5 s** | – |
| 10 000 lignes (2 020 doublons) | 201, 7 980 créées | **52 s**, dans une seule requête HTTP | – |

Conclusions :
- Le parsing d'un fichier de 5 Mo est **acceptable** : synchrone, mais court.
- L'**écriture** ligne à ligne est le problème, à ~5 ms par ligne. 50 imports par jour de
  2 000 lignes représentent ~10 min de travail DB cumulé. Un seul import de 10 k lignes tient une
  requête pendant 52 s, et Traefik ou le navigateur peuvent couper avant la fin.
- Les chemins « fiche registre » et « mapping IA » **n'ont pas de plafond de lignes** (P0-5). Ils
  n'ont pas pu être mesurés : il n'y avait pas de fiche dans la base et l'IA était coupée.

### 3.6 Nettoyage

Les données de test vivent dans une base locale jetable (`mtc_load`), détruite avec le conteneur
d'audit. **Aucune donnée n'a été écrite en dev.** Pour un seed sur le vrai dev :
`LOAD_TEST_DATABASE_URL=… ./tools/load-tests/seed/seed-load.sh --clean` supprime tout ce qui
appartient aux users `@loadtest.invalid`.

---

## 4. Budget ressources du VPS-3 au pic (1 000 simultanés, après correctifs P0/P1)

VPS-3 : 6 vCores, 12 Go RAM, 100 Go NVMe. Topologie recommandée : **séparer le process HTTP du
process « worker »** (crons + processors BullMQ + WebSockets Tradovate), aujourd'hui confondus
dans le cluster (`main.ts:101-147`, `app.module.ts:72`).

| Conteneur | Rôle | RAM au pic [E] | `mem_limit` recommandé | CPU au pic [E] | `cpus` recommandé |
|---|---|---|---|---|---|
| `mtc_api_prod` | HTTP + socket.io, **4 workers** (`WEB_CONCURRENCY=4`), `NODE_OPTIONS=--max-old-space-size=384` | 1,5–2,0 Go (mesuré 2,0 Go PSS à 1 000 VU **sans** plafond de tas, passage C) | **3 g** (à redescendre à 2 g après mesure en dev) | 1,5 cœur mesuré à 1 000 VU (passage C) + TLS/pics → 2–2,5 | **3.5** |
| `mtc_worker_prod` (nouveau, même image, `IS_CRON_WORKER=true`, `HTTP_DISABLED`) | crons, BullMQ (debrief, stripe, + futurs `tradovate-sync`, `import`, `email`), ~1 800 WebSockets Tradovate, Chromium PDF (1 à la fois) | 0,6–1,0 Go (+ 250 Mo si PDF) | **1536m** | 0,5–1,0 cœur | **1.5** |
| `mtc_postgres` (dédié prod) | PostgreSQL 17, `shared_buffers=2GB` | 2,5–3,5 Go (2 Go buffers + ~40 backends × 10–30 Mo) | **4 g** | 0,5–1,5 cœur | **2** |
| `mtc_pgbouncer` | pool transaction | < 50 Mo | 128m | < 0,1 | 0.25 |
| `mtc_redis` (dédié prod) | BullMQ + cache + throttler + socket.io adapter | 100–250 Mo [E] (mesuré 2–6 Mo à 1 000 VU sans BullMQ chargé) | **768m** (`maxmemory 512mb`) | < 0,2 | 0.5 |
| `mtc_traefik` | TLS + reverse proxy | 80–150 Mo | 256m | 0,2–0,4 (TLS) | 1 |
| `mtc_app_static` (nginx, app Angular) | assets | < 30 Mo | 64m | < 0,05 | 0.25 |
| node-exporter / cAdvisor (optionnel) | métriques pour Uptime Kuma/Grafana externes | ~100 Mo | 256m | < 0,1 | 0.25 |
| **Total limites** | | | **≈ 10 Go** | | (somme > 6 : volontaire, les pics ne coïncident pas) |
| OS + Docker + page cache | | ≈ 2 Go libres | | | |

Les `cpus` sont des plafonds anti-famine, pas des réservations : leur somme dépasse 6 exprès.
L'important est qu'aucun conteneur ne puisse prendre les 6 cœurs (aujourd'hui aucun `cpus` n'est
posé nulle part, et l'image API est **buildée sur le VPS de prod** pendant le trafic, `cd.yml:67-68`).

Le page cache restant (~2 Go) + `shared_buffers` 2 Go contiennent **toute la base à 10 k users
pendant 1 an** (≈ 1–2 Go de données chaudes, voir §9) : les lectures resteront en RAM.

---

## 5. Configuration recommandée

### 5.1 PostgreSQL 17 (dédié prod, 12 Go RAM partagés avec la stack)

Config réelle du conteneur **non lisible depuis l'audit** (pas d'accès SSH au VPS ; le
compose `/opt/infra/databases/docker-compose.yml` n'est pas versionné). Seule valeur connue :
`max_connections = 50` (mesuré le 30/09, `docs/pre-launch-checklist-newsletter-2026-09-30.md:130`).

```conf
max_connections = 100            # 50 aujourd'hui ; marge pour pgbouncer + migrations + pg_dump + admin
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB                  # 40 connexions actives × quelques sorts : < 1 Go dans le pire cas
maintenance_work_mem = 512MB
random_page_cost = 1.1           # NVMe
effective_io_concurrency = 200
wal_compression = on
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_completion_target = 0.9
shared_preload_libraries = 'pg_stat_statements'
log_min_duration_statement = 250ms
log_autovacuum_min_duration = 1s
autovacuum_vacuum_scale_factor = 0.05   # Trade grossit vite, vacuum plus tôt
```

### 5.2 PgBouncer

`pool_mode = transaction`, `default_pool_size = 30` (une seule base prod sur l'instance dédiée),
`max_client_conn = 300`, `reserve_pool_size = 5`. Plus de prod/beta/dev derrière le même
PgBouncer (aujourd'hui 3 × 25 = 75 connexions serveur possibles pour 50 autorisées).

### 5.3 Pool Prisma (`prisma.service.ts:19-24`)

Le `connection_limit=1` de `DATABASE_URL` est **ignoré** depuis le passage au driver adapter
`PrismaPg` : c'est `pg.Pool({ max: 10 })` qui s'applique, par worker. Rendre `max` configurable
(`DB_POOL_MAX`), et respecter `workers × max ≤ default_pool_size` :
API 4 workers × 6 + worker 1 × 6 = **30 connexions client** → PgBouncer 30 → Postgres ≤ 100.

### 5.4 Redis (dédié prod)

```conf
maxmemory 512mb
maxmemory-policy noeviction      # OBLIGATOIRE : Redis porte BullMQ, une éviction détruit des jobs
appendonly yes
appendfsync everysec
```

Toutes les clés de cache ont déjà un TTL (vérifié), sauf `ai:calls:<uid>:<mois>` dont l'`EXPIRE`
n'est pas atomique avec l'`INCR` (`ai.service.ts:571-573`, fuite mineure). Alerte à 70 % de
`maxmemory`. En cible, **plus aucun Redis partagé** : aujourd'hui les files `stripe` et `debrief`
portent le même nom en prod/beta/dev sans `prefix` ni `db` (`app.module.ts:62-68`) — un worker dev
peut consommer un webhook Stripe de prod. La cible (Redis dédié) corrige ce point ; en attendant,
poser `prefix: process.env.BULL_PREFIX` et un `db` par environnement.

### 5.5 Instances

| Composant | Recommandation | Raison |
|---|---|---|
| API HTTP | **1 conteneur, 4 workers** (`WEB_CONCURRENCY`, au lieu de `availableParallelism()` = 6 sur le VPS-3) | 6 workers × ~250 Mo dépassent le `mem_limit: 1g` actuel ; 4 workers laissent 2 cœurs à Postgres/Redis/Traefik |
| Worker | **1 conteneur séparé**, crons + BullMQ + WebSockets Tradovate | un job lourd ou un cron séquentiel ne bloque plus un worker HTTP ; un seul exécutant de cron |
| Réplicas | **Non** avant 10 k : chaque conteneur API lance son propre worker cron (`main.ts:143-145`) → N exécutions de chaque cron | passer par un verrou Redis / `upsertJobScheduler` BullMQ avant tout 2e conteneur |

---

## 6. Coût IA mensuel estimé à 10 000 inscrits

Tous les chiffres **[E]** — aucun appel réel. Tarifs : Sonnet 4.6 = 3 $ / 15 $ par MTok,
Haiku 4.5 = 1 $ / 5 $ par MTok (`ai-pricing.const.ts:5-10`). Hypothèses : 1 500 DAU, 500 PREMIUM,
22 jours de bourse / mois.

| # | Fonction (clé `AiUsageLog`) | Modèle | Déclencheur | Appels / mois | Coût / mois |
|---|---|---|---|---|---|
| 1 | Weekly debrief | Sonnet, `max_tokens` ≤ 8 192 | cron dim. 23h → BullMQ | ~2 400 | ~120 $ |
| 2–3 | IA Insights (pattern + coach) | Sonnet 1 024 / 512 | HTTP, synchrone | ~8 000 | ~85 $ |
| 4 | Chat coach | Sonnet 512 | HTTP, synchrone | ~15 000 | ~150 $ |
| 5 | Recap quotidien | Sonnet 200 | cron 17h30, `Promise.all` | ~6 600 | ~30 $ |
| 6 | Analyse éco du matin | Haiku 1 024 | 1er GET du jour, **par signature top-5 actifs** | 26 000–44 000 | 90–150 $ |
| 7 | Analyse d'un événement publié | Haiku 700 | POST front, **par signature** + ruée au broadcast | 130 000–210 000 | 165–265 $ |
| 8–10 | Traductions news / libellés | Haiku | cron | ~3 000 | ~10 $ |
| 11–12 | Import CSV (mapping + repli ligne à ligne) | Haiku / Sonnet 8 192 × 17 lots | HTTP, synchrone | ~250 | ~30 $ |
| | **Total scénario central** | | | | **≈ 680–890 $ / mois** (≈ 3–4 % d'un MRR de ~24,5 k€) |
| | Scénario corrigé : +300 essais en cours (ils ont les features PREMIUM, 30 j) | | | | **≈ 850–1 100 $ / mois** |
| | Plafond théorique sous les quotas actuels (chat 100/mois × historique 45 k tokens non plafonné) | | | | **≈ 8–9 k$ / mois** |

Écarts aux principes de coût du projet :

- **Mutualisation O(classes d'actifs) non respectée** pour #6 et #7 : la clé est la *signature des
  5 actifs les plus tradés* de chaque user (`eco-calendar.service.ts:280-293`, `:422-424`). Le
  coût croît avec le nombre d'users (≈ 40–45 % de la facture). `plans.md:120-122` affirme le
  contraire.
- **Pas de single-flight** sur #6, #7, #9 : au broadcast `eco:new-releases`, chaque client connecté
  appelle `refresh-today` + N × `analyze-result` (`live-eco-calendar.component.ts:169-199`) ; tous
  ratent le cache en même temps → plusieurs appels Haiku pour la même clé.
- **`max_tokens` plafonné partout** (OK), mais **l'entrée ne l'est pas** : historique du chat jusqu'à
  40 × 4 000 caractères (`ai.controller.ts:30-38`), trades de la semaine en JSON indenté pour le debrief.
- **`cache_control`** posé à 6 endroits mais aucun préfixe n'atteint le minimum (1 024 tokens pour
  Sonnet 4.6, 4 096 pour Haiku 4.5) : sans effet, sans surcoût.
- **Coût invisible** : l'analyse éco du matin loggue `userId: 'shared'` (`eco-calendar.service.ts:306`)
  → violation de FK sur `AiUsageLog.userId` → la ligne n'est jamais écrite ; `costUsd` ignore
  `cache_creation`/`cache_read`.
- **Appels dans la requête HTTP** : insights, chat, analyse éco, import CSV (jusqu'à 17 lots Sonnet
  séquentiels). Timeout SDK = max(60 s, 30 ms × `max_tokens`), `maxRetries: 1`
  (`anthropic-client.service.ts:18`).
- **429 / 529 au pic** : 1 retry SDK puis erreur mappée (529 → 503, 429 → 429,
  `anthropic-errors.util.ts`) ; le recap quotidien avale l'erreur (`aiOneLiner = null`). Pas de
  file avec `limiter`. Le cooldown Insights de 4 h est posé **avant** l'appel (`ai.service.ts:521`) :
  un échec bloque l'user 4 h sans résultat.
- **Garde d'environnement** : la seule garde fiable est `AI_ENABLED === 'true'`
  (`anthropic-client.service.ts:22-26`) ; certaines fonctions testent `NODE_ENV`, or le dev tourne en
  `NODE_ENV=production`. Pour les tests de charge, `AI_ENABLED=false` a été posé et vérifié.

---

## 7. Plan d'action

Chaque ligne est dimensionnée pour devenir un prompt séparé. « Gain » = effet attendu **[E]** sauf mention.

### 7.1 Avant 1 000 inscrits (≈ 150 DAU, ≈ 100 simultanés)

| # | Fichier(s) | Changement | Gain |
|---|---|---|---|
| P0-1 | `setups/setups.service.ts:23-27`, `session/session.service.ts:57-60`, `users/users.service.ts:204`, `ambassador/ambassador.service.ts:267` | Remplacer `include: { _count: { select: { trades: true } } }` par un `trade.groupBy({ by: ['setupId'], where: { userId }, _count: true })` (ou `trade.count({ where: { sessionId } })`). Prisma 7 génère ici un `GROUP BY` sur **toute** la table Trade | `GET /setups` : 0,37 s à vide, 1,37 s de moyenne sous charge **[M]** → < 5 ms ; `GET /session/active` : jusqu'à 2 s **[M]** → < 2 ms ; −99 % du temps DB ; passage C : 1 000 VU tenus **[M]** |
| P0-2 | `analytics/analytics.service.ts:38-42` + appels `trades.service.ts:128,275,416,439,459` | Remplacer `KEYS analytics:<uid>:*` par un compteur de version (`INCR analytics:ver:<uid>` inclus dans la clé) ; n'invalider qu'**une fois** par import | Supprime le blocage Redis O(keyspace) × N lignes importées |
| P0-3 | `app-mytradingcoach/.../dashboard.component.ts:151-152,196` | Normaliser `to` au jour (`YYYY-MM-DD`) : aujourd'hui `to` est à la milliseconde → **0 % de hit** sur le cache analytics | Cache dashboard enfin effectif (÷5–10 sur les agrégats) |
| P0-4 | `vps/docker.service.ts:84-91`, `vps.controller.ts:31-49` | Valider `:id` (`^[a-zA-Z0-9_.-]{1,64}$`) avant `docker ${action} ${id}` exécuté en SSH | Ferme une injection de commande (RCE hôte via token admin volé) |
| P0-5 | `trades/csv-import.service.ts:152-157, 446, 638-679` | Appliquer `MAX_KNOWN_ROWS` (10 000) à **tous** les chemins (fiche registre, mapping IA) | Borne le pire cas d'import (aujourd'hui illimité) |
| P0-6 | `docker-compose.prod.yml` | `WEB_CONCURRENCY` lu par `main.ts:102`, `NODE_OPTIONS=--max-old-space-size=384`, `cpus`, `logging` explicite | Plus d'OOM du conteneur entier ; indispensable avant le VPS-3 (6 cœurs → 6 workers → > 1 Go) |
| P0-7 | `integrations/tradovate/tradovate-api.client.ts:134-143`, `tradovate-reporting.client.ts:96-118` | Détecter `p-ticket` / `p-time` / `p-captcha` partout (y compris oauthtoken et Reporting) ; captcha = terminal + alerte ; pénalité Reporting ≠ « mois vide » | Supprime une **perte silencieuse d'historique** et des connexions condamnées à tort |
| P0-8 | `integrations/tradovate/*-cron.ts` | Garde anti-chevauchement (`waitForCompletion: true` + verrou Redis `cron:<nom>`) | Plus de passages empilés dès ~300 connexions |
| P0-9 | `pdf/pdf.service.ts:46` | Un navigateur partagé par process + sémaphore 1 (ou job BullMQ) | 2–3 PDF simultanés ne tuent plus le conteneur |

### 7.2 Avant 5 000 inscrits (≈ 750 DAU, ≈ 250–500 simultanés, ~1 500 connexions Tradovate)

| # | Fichier(s) | Changement | Gain |
|---|---|---|---|
| P1-1 | `analytics/analytics.service.ts:97-484`, `trades.service.ts:293-296`, `accounts.service.ts:67-82` | Agréger en SQL (`groupBy` / `aggregate` / `$queryRaw` avec `date_trunc(... AT TIME ZONE 'Europe/Paris')`, `COUNT(*) FILTER`) au lieu de `findMany` sans `take` + JS ; au minimum, sortir le `Intl.DateTimeFormat` de la boucle | 8 000 lignes **[M]** → < 400 par endpoint ; ~1 s de CPU Node en moins par dashboard froid d'un gros trader |
| P1-2 | `trades/trades.service.ts:182-240` | `importTrades` : dédup bornée à la fenêtre de dates du lot, résolution setup/session/compte **une fois**, `createMany({ skipDuplicates: true })` par 500, un seul recalcul + une seule invalidation | 2 000 lignes : ~12 000 requêtes → ~10 ; appelé aussi à **chaque** synchro Tradovate |
| P1-3 | `trades/behavioral-grades.ts:14-84` | Index `Trade(accountId, tradedAt)` ; un seul `UPDATE … FROM (VALUES …)` par lot ; exécution en job BullMQ débouncé par compte | La création de trade ne tient plus une connexion et des verrous plusieurs secondes |
| P1-4 | `tradovate-background-refresh.cron.ts:56-131` | File BullMQ `tradovate-sync` (concurrency 15–20, `limiter`, `jobId` par slot) ; espacer les connexions d'users inactifs (> 24 h) à 1–4 h ; étaler le rattrapage mensuel (`hash(connId) % 4`) | Passage horaire à 3 000 connexions : ~1,7–3 h → ~10 min ; −70 % de trafic Tradovate |
| P1-5 | Nouveau `tradovate-rate-gate.ts` + clients Tradovate | Disjoncteur par login (clé Redis `tradovate:penalty:<login>` 60 min après 429/pénalité) + seau à jetons global (~30 req/s) | Fin des boucles de lockout d'1 h, trafic sortant plafonné |
| P1-6 | `tradovate.controller.ts:164-174`, `background-refresh.cron.ts:22` | Import d'historique en job BullMQ (concurrency 5, `jobId` par connexion, retry), relever `FULL_BACKFILLS_PER_PASS` (2/h aujourd'hui) | 100 connexions/h (jour de campagne) absorbées en 10–20 min, survit aux déploiements (archivage Tradovate à 10 j) |
| P1-7 | `daily-recap/daily-recap.cron.ts:35`, `resend/resend.cron.ts:36-44`, `admin/email-campaign.service.ts:157-185` | File BullMQ `email` avec `limiter` Resend (ou API batch), recap en jobs par user (concurrency 5) ; campagne admin hors requête HTTP | Zéro email perdu en silence (`resend.service.ts:260-275` avale les 429), plus de requête HTTP de 67 min |
| P1-8 | `debrief/debrief.cron.ts:35,67`, `debrief.processor.ts` | `jobId: debrief:<uid>:<année>-W<sem>`, `concurrency: 5`, `removeOnFail: { age: 30 j }` ; ne plus logguer la liste des emails (`debrief.cron.ts:41-43`) | File vidée en ~1–2 h au lieu de ~12 h ; pas de doublon IA ; plus de PII dans les logs |
| P1-9 | `eco-calendar.cron.ts:28-35`, `eco-calendar.service.ts:280-316, 394-445, 469-494` | Calculer l'analyse **côté serveur avant** le broadcast, clé (date, événement, classe d'actifs), verrou `SET NX` ; `range` : un seul `findMany` + cache 60 s, **jamais** d'appel FMP sur le chemin user (jour férié = marqueur « vide ») | −250 à −400 $/mois ; plus de ruée de 4–6 k requêtes à chaque publication |
| P1-10 | `common/interceptors/presence.interceptor.ts:14-33`, `auth/jwt.strategy.ts:22-37` | Présence dédupliquée en Redis (`SET presence:<uid> NX EX 60`) ; projection user du JWT en cache Redis 60 s | Écritures `User` ÷ nombre de workers ; −30 à −40 % de lectures PK |
| P1-11 | `common/throttler/email-aware-throttler.guard.ts` | Compter par `user.id` sur les routes authentifiées, garder IP + IP/email sur `/auth/*` + un 2e seuil IP-seul ; `@Throttle` dédiés sur `trades/import`, PDF, `debrief/generate` | Plus de 429 entre collègues d'une même prop firm (NAT) ; bourrage d'identifiants borné |
| P1-12 | `prisma/schema.prisma` | `Trade @@index([setupId])`, `@@index([accountId, tradedAt])` (remplace `[accountId]`), `AiUsageLog @@index([userId, createdAt])` ; retirer 5 index doublons (`DailyRecap`, `UserDailyActivity`, `EcoCalendarCache`, `MetricsSnapshot`, `EcoAnalysisCache`) | FK `Setup` et `_count` couverts ; tri des notes comportementales sans sort |

### 7.3 Avant 10 000 inscrits (1 000 simultanés, 3 000 connexions)

| # | Fichier(s) | Changement | Gain |
|---|---|---|---|
| P2-1 | `main.ts`, `app.module.ts`, compose | Conteneur **worker** séparé (crons + BullMQ + WebSockets Tradovate), API sans processors ni crons ; crons protégés par verrou Redis | Permet un 2e conteneur API sans doubler les crons |
| P2-2 | `tradovate-sync.service.ts:161-217`, `tradovate-live.service.ts` | Un WebSocket **par login** (tous les comptes), snapshot de session partagé (cache Redis ~2 s) ; idéalement construire les trades depuis les `props` du WS | Copy-traders : ~4 800 → ≤ 1 000 req/h ; sockets ÷ ~1,5 ; plus de `ConnectionQuotaReached` |
| P2-3 | `tradovate-live.protocol.ts:107-109`, `tradovate-live.service.ts:106-119` | Jitter complet sur le backoff, `p-limit` sur les catch-up, catch-up après ré-autorisation du WS | Pic de redéploiement : ~15–20 k req/min vers Tradovate → < 2 k/min |
| P2-4 | `tradovate-locks.ts`, `token-manager.ts:114-120` | Verrous à jeton propriétaire (compare-and-delete Lua), attente réelle du verrou de login, cooldown de refus par login | Fin des rotations concurrentes de refresh token |
| P2-5 | `app-mytradingcoach/.../session.store.ts:88-125`, `auth.service.ts:71` | Pause du polling onglet masqué ; `/auth/me` toutes les 5 min (le `visibilitychange` couvre le retour) | −30 à −50 % de requêtes de polling |
| P2-6 | Nouveau cron de rétention | Purger / agréger `AiUsageLog` > 13 mois, `StripeEvent` > 90 j, `MarketNews` > 30 j, `EmailSend` > 12 mois | Croissance disque bornée |
| P2-7 | Sauvegardes | WAL archiving (pgBackRest / wal-g → Object Storage), `backup.sh` versionné, runbook de restauration testé | RPO 24 h → ~5 min |

---

## 8. Prérequis de migration vers le VPS-3 découverts pendant l'audit

1. **DNS de l'hôte** : reproduire le correctif du VPS actuel (`systemd-resolved` avec `1.1.1.1` +
   `9.9.9.9`, résolveur OVH en repli). Il n'est documenté **nulle part** dans le dépôt
   (`docs/ops`, agents) : à écrire dans `deploy.md` pendant la migration. Tous les appels sortants
   (Anthropic, Stripe, Resend, FMP, Yahoo, Tradovate) en dépendent.
2. **`WEB_CONCURRENCY`** : sur 6 vCores, `availableParallelism()` lancerait 6 workers (+ primaire) ≈
   0,9–1,2 Go au repos, soit au-dessus du `mem_limit: 1g` actuel → OOM au premier pic.
3. **`NODE_OPTIONS=--max-old-space-size`** : absent (chaque worker croit disposer de ~2 Go).
4. **`mem_limit` / `cpus` / `logging`** sur **tous** les conteneurs (Postgres, Redis, Traefik
   compris) : aucun `cpus` n'existe aujourd'hui ; la rotation des logs (3 × 50 Mo) vient du
   `daemon.json` de l'hôte actuel, à recréer sur le VPS-3.
5. **`ulimit nofile`** du conteneur API/worker ≥ 65 535 (≈ 4–5 k descripteurs au pic : 1 800 WS
   Tradovate + 1 200–2 000 sockets navigateur + pools).
6. **CORS** : `CORS_ORIGINS` doit contenir l'origine exacte de l'admin sur Vercel (ex.
   `https://admin.mytradingcoach.app`) ; `*.vercel.app` ne passe pas (liste exacte, pas de
   joker). `main.ts:72` ne fait pas de `trim()` : pas d'espace après les virgules.
7. **Redis dédié** : `maxmemory 512mb`, `noeviction`, AOF ; aucun Redis partagé avec beta/dev.
8. **PostgreSQL dédié** : config §5.1, `max_connections 100`, `pg_stat_statements` ; PgBouncer à
   une seule base.
9. **Build de l'image hors du VPS de prod** (CI → registre), pour ne plus voler du CPU au trafic.
10. **Callback OAuth Tradovate** (`TRADOVATE_OAUTH_REDIRECT_URI`) et **webhook Stripe** pointent
    sur `api.mytradingcoach.app` : inchangés si le DNS bascule, mais vérifier le TTL DNS (≤ 300 s)
    avant la bascule, et que `BROKER_TOKEN_ENCRYPTION_KEY` est **identique** (sinon tous les jetons
    Tradovate chiffrés deviennent illisibles).
11. **Firewall** : Postgres/Redis non exposés publiquement ; seul le port 5432 (ou un tunnel)
    ouvert vers le VPS-1 pour les `pg_dump` croisés, idéalement en poussant depuis le VPS-3.
12. **Admin sur Vercel** : toutes les routes admin/métriques vérifient `ADMIN` côté serveur
    (vérifié, §10.8) ; en revanche les routes `/vps/*` exécutent des commandes SSH sur l'hôte
    (`VPS_SSH_KEY_B64`) : sur le VPS-3 la clé doit viser le VPS-3, et P0-4 doit être fait avant.
13. **Uptime Kuma** (VPS-1) : sonder `/api/health/ready` (DB + Redis), pas seulement `/api/health`.

---

## 9. Hypothèses et limites

- **Environnement de test** : le dev (`dev.api.mytradingcoach.app`) et le VPS-1 ne sont **pas
  joignables** depuis le conteneur d'audit (proxy de sortie : `connect_rejected`), et l'audit n'a
  pas d'accès SSH ni aux bases dev. Les tests ont donc tourné sur une **réplique locale** de la
  stack dev, dans le conteneur d'audit : **4 vCPU, 15 Go RAM**, PostgreSQL **16** (prod : 17),
  Redis 7.0, API buildée en `--configuration=production` et lancée en `NODE_ENV=production`
  (cluster de 4 workers, comme la prod actuelle), **sans Traefik ni TLS**, **k6 sur la même
  machine** (il consomme une partie du CPU, mesuré dans le tableau §3). C'est une **borne
  basse**, comparable au VPS-1 (4 vCores) ; l'extrapolation au VPS-3 est argumentée au §3.
- **Aucun appel externe** : `AI_ENABLED=false`, `NEWS_TRANSLATION=off`, clés Stripe/Resend
  factices, pas de `FMP_API_KEY`, pas de connexion Tradovate. Les clés Redis `market:context` et
  `price:NQ` ont été pré-remplies **sans TTL** pour que `market/context` et `market/live-price` ne
  sortent jamais vers Yahoo : la **ruée au moment de l'expiration du cache** (pas de single-flight)
  **n'est donc pas mesurée**. Le coût de la synchro Tradovate, des crons et de l'IA est **estimé**
  depuis le code.
- **Jeu de données** : 10 000 users, **2 232 050 trades** répartis de façon inégale (1 % à 5–8 k
  trades, 19 % à 300–600, 80 % à 0–150 ; max 7 991), 1 022 005 sessions, 30 000 setups,
  19 953 comptes, 5 % PREMIUM. Artefacts connus : (a) ~2 % des trades tombent « aujourd'hui »
  (≈ 150 pour un gros trader), ce qui alourdit `session/today/stats` ; (b) les notes d'exécution
  du seed sont aléatoires : la **première** création de trade d'un compte déclenche un recalcul
  qui réécrit des milliers de notes (`behavioral-grades.ts`) — la latence d'écriture mesurée est
  donc **pessimiste** pour la 1re écriture par compte, réaliste ensuite.
- **Scénario k6** : reproduit le polling réel du front (`polling.const.ts`, `session.store.ts`) et
  une navigation par minute ; chaque VU a sa propre IP (`X-Forwarded-For`). Il ne couvre **pas** :
  les WebSockets socket.io (`/eco`, `/tradovate-live`), la ruée au broadcast éco, l'import CSV
  concurrent, l'admin, le PDF, les crons (qui tournaient mais sans données à traiter).
- **17 utilisateurs réels** ne donnent aucun ratio fiable : les hypothèses §2 du prompt sont
  gardées. Scénario corrigé signalé là où le code contredit une hypothèse (essais PREMIUM, part
  de copy-traders multi-comptes).
- Non vérifiable depuis le dépôt : config réelle Postgres/Redis/Traefik/nginx du VPS
  (fichiers hors dépôt), `.env.production`, `daemon.json`, `backup.sh`.

---

## 10. Détail de l'audit par domaine

Chemins relatifs à `apps/api-mytradingcoach/src/` sauf mention.

### 10.1 Base de données (Prisma / PostgreSQL)

**Volumétrie [M]** (seed 10 k users / 2,23 M trades, après `VACUUM FULL`) : table `Trade` 523 Mo +
index 268 Mo ; `TradeSession` (1 M lignes) 131 + 93 Mo ; base entière **1,05 Go**. Avant compaction
(après l'`UPDATE` du seed), `Trade` pesait 998 + 855 Mo : le *bloat* réel se situera entre les deux.

**Projection 1 an [E]** : Trade + sessions ≈ 1,0–1,8 Go ; `WeeklyDebrief` (3 JSON de 5–10 Ko,
~250 k lignes/an) 2–5 Go ; `AiUsageLog` 5–10 M lignes ≈ 1–2 Go ; `EmailSend`, `UserDailyActivity`
(~1,5 M lignes), `DailyRecap`, `MarketNews` ≈ 1 Go → **base ≈ 5–9 Go**. Disque 100 Go : base 9 Go
+ WAL 2 Go + images Docker (API 652 Mo × 3–5 versions + Postgres/Redis/Traefik ≈ 4 Go) + dumps
locaux 14 j (~1 Go compressé chacun ≈ 14 Go) + logs bornés (< 1 Go) ≈ **30–35 Go** → **OK**,
marge > 60 %.

**Requêtes chaudes** :

| Endpoint | Requête | Mesure (user le plus lourd, 7 991 trades) | Verdict |
|---|---|---|---|
| `GET /setups` | `setup.findMany({ include: { _count: { trades } } })` (`setups.service.ts:23-27`) → Prisma génère `LEFT JOIN (SELECT "setupId", COUNT(*) FROM "Trade" WHERE 1=1 GROUP BY "setupId")` : **Parallel Seq Scan de toute la table** | **373 ms** en `EXPLAIN ANALYZE`, **522 ms** de moyenne sous charge [M] ; **n°1 du temps DB total** (`pg_stat_statements`) ; O(trades de tous les users) | **Bloquant** |
| `GET /session/active` | `tradeSession.findFirst({ include: { _count: { trades } } })` (`session.service.ts:57-60`) → même motif sur `sessionId` | 3 ms à **1 986 ms** selon la position de l'id dans l'index [M] ; avec des cuid (croissants), la session **la plus récente** est la pire → en prod, c'est le cas normal | **Bloquant** |
| Dashboard `/analytics/*` (6 appels) | `trade.findMany` **sans `take`**, agrégat en JS (`analytics.service.ts:97-484`) | 8 000 lignes chargées en 5 ms côté PG [M], 25–155 ms par endpoint à froid, dont l'essentiel en CPU Node | À surveiller → Bloquant à 1 000 simultanés (CPU) |
| Cache analytics | clé contenant `to` à la milliseconde (`dashboard.component.ts:151-152,196`) | 0 % de hit [E, lecture du code ; confirmé : 2e appel identique ≠ du 1er] | **Bloquant** (bug) |
| `GET /analytics/equity-curve` | tous les points, sans agrégation | **559 Ko** de réponse pour 8 k trades [M] | À surveiller |
| `GET /session/today/stats` | lignes `Trade` complètes du jour, sans `select` | 84 Ko pour ~150 trades [M], toutes les 30 s par user actif | À surveiller |
| `GET /trades?limit=50` | curseur, `take`, index `(userId, tradedAt)` | 18–35 ms [M] | OK (pas de tie-breaker `id` dans l'`orderBy`) |
| `GET /trades/stats` | `findMany` complet + somme JS (`trades.service.ts:293-296`) | 29–72 ms [M] | À surveiller (→ `aggregate`) |
| `GET /accounts` | tous les trades clôturés de tous les comptes (`accounts.service.ts:67-82`) | 100–115 ms [M] | À surveiller |
| `POST /trades` | 6–8 requêtes + `KEYS` Redis + `recomputeBehavioralGrades` (tous les trades du compte + 1 `UPDATE` par note modifiée dans une transaction) | voir §3 | **Bloquant** (gros comptes) |
| `importTrades` (CSV + **chaque** synchro Tradovate) | `findMany` de tous les trades du user puis `for … await create()` : ~6 requêtes + 1 `KEYS` par ligne (`trades.service.ts:182-240`) | 2 000 lignes ≈ 12 000 requêtes [E] | **Bloquant** |
| Admin (`adminStats`, rétention, snapshot) | `count` + `EXISTS` corrélés sur `(userId, tradedAt)` | ~100–400 ms à 10 k users [E] | OK |

**N+1** : `importTrades` (ci-dessus) ; `behavioral-grades.ts:75-84` (1 `UPDATE` par trade) ;
`daily-recap.cron.ts:35` (`Promise.all` non borné) ; `email-campaign.service.ts:167-185`
(séquentiel **dans la requête HTTP**, ~67 min pour 10 k users) ; `tradovate-background-refresh.cron.ts:96-120`.

**Index** — manquants : `Trade(setupId)` (FK `NoAction` + `_count` ; mesuré : l'`Index Only Scan`
complet de `(userId, setupId)` prend 15 ms, pas un seq scan de 2 M, donc « À surveiller » et non
bloquant tant que P0-1 est fait), `Trade(accountId, tradedAt)`, `AiUsageLog(userId, createdAt)`.
Doublons à retirer : `DailyRecap[userId,date]`, `UserDailyActivity[userId,date]`,
`EcoCalendarCache[date]`, `MetricsSnapshot[date]`, `EcoAnalysisCache[date]`.

**Pool** : `pg.Pool({ max: 10 })` par worker (`prisma.service.ts:23`), `connection_limit=1` ignoré.
Prod actuelle : 4 workers × 10 = 40 clients → PgBouncer (25/base) → Postgres `max_connections 50`
pour 3 bases. **Mesuré sous charge** : voir §3 (connexions PG).

**Écriture par requête** : `PresenceInterceptor` = 1 `UPDATE User` / min / user **par worker**
(Map locale jamais purgée, `presence.interceptor.ts:14-33`) → jusqu'à 4 écritures/min/user
aujourd'hui, 6 sur le VPS-3. `JwtStrategy.validate` = 1 `SELECT User` par requête (`jwt.strategy.ts:22-37`).

### 10.2 Redis et BullMQ

| File | Producteur | Consommateur | Concurrency | Rétention | Verdict |
|---|---|---|---|---|---|
| `debrief` | `debrief.cron.ts:35` (dim. 23h), `:67` (lun. 8h rattrapage), admin | `debrief.processor.ts:9` | 1 par process (défaut) | `removeOnComplete: true`, `removeOnFail: false` (échecs gardés à vie) | À surveiller → Bloquant : 2 400–3 000 jobs × 30–90 s / 4 ≈ **12 h** [E], pas de `jobId` → doublons au rattrapage |
| `stripe` | `stripe-webhook.service.ts:77` | `stripe.processor.ts:18` | 1 | `{count:100}` / `false` | OK |

Aucun `defaultJobOptions`, aucun `prefix`/`db` (`app.module.ts:62-68`). Les processors tournent
**dans chaque worker HTTP** du cluster.

**Crons** (seulement sur le worker `IS_CRON_WORKER=true` ; aucun `waitForCompletion` → un passage
démarre même si le précédent tourne) :

| Cron | Planning | Itère sur | Durée à 10 k / 3 k connexions [E] | Verdict |
|---|---|---|---|---|
| Tradovate fond (`tradovate-background-refresh.cron.ts:56`) | */15 | connexions non « live » > 12 min (~1 800) ; **toutes** (3 000) au 1er passage de l'heure ; séquentiel | 20–30 min / passage, **75 min – 3 h** pour l'horaire → chevauchements | **Bloquant** |
| Tokens Tradovate (`tradovate-token-refresh.cron.ts:46`) | :17 | refresh < 18 h, séquentiel | 2–3 min normal ; 25–60 min après une panne | À surveiller |
| Recap quotidien (`daily-recap.cron.ts:19`) | 17h30 L-V | PREMIUM ayant tradé (~300–1 000) | rafale `Promise.all` : saturation pool (10) + 429 Anthropic/Resend, emails perdus sans trace | **Bloquant** |
| Rappels / campagnes auto (`resend.cron.ts:15`, `auto-campaigns.cron.ts:26`) | 10h | jusqu'à 10 k users, 2 requêtes `canSend` chacun | 1–3 min + envois | À surveiller |
| Éco relevés (`eco-calendar.cron.ts:29`) | chaque minute 8h–17h | global | < 5 s ; `fetch` FMP sans timeout | OK (+ timeout) |
| Éco fin de journée (`eco-calendar.cron.ts:41`) | 18h30 | `KEYS eco:calendar:<date>:*` | 1×/jour | À surveiller (→ `SCAN`) |
| Autres (news, métriques, anonymisation, coût Anthropic, seed démo) | | global | secondes | OK |

**Cache** : ioredis direct, TTL présents partout (sauf l'`INCR`/`EXPIRE` non atomique de
`ai:calls`). `KEYS analytics:<uid>:*` à **chaque** écriture de trade (`analytics.service.ts:40`) :
O(taille du keyspace), bloquant pour BullMQ, le throttler et les verrous. Mémoire Redis mesurée
sous 1 000 VU : voir §3.

**Config Redis prod** : hors dépôt, non vérifiable. Le `docker-compose.yml` local utilise
`--maxmemory 128mb --maxmemory-policy noeviction` (bonne politique). Recommandation §5.4.

### 10.3 Intégration Tradovate (risque n°1 hors HTTP)

- **Synchro live** : un WebSocket `user/syncrequest` **par connexion** sert de déclencheur ; chaque
  événement (débounce 1,5 s) relance un `sync()` REST **complet** de la session
  (`tradovate-live.service.ts:242-252`, `tradovate-sync.service.ts:161-253`) : 3 appels si la session
  est vide, ≥ 8 sinon. Ce n'est pas « une synchro toutes les quelques secondes », mais une synchro
  complète **par rafale de fills**.
- **Requêtes / h / connexion [E]** : inactive ~16 ; app fermée avec trades ~35 ; live modéré ~165 ;
  scalpeur ~960 ; **copy-trader 5 comptes sur un login ~4 800 → 429 et 1 h de blocage** (limite
  ~5 000/h/user, `docs/tradovate-api-capabilities.md:289`). **Total à 1 200 live + 1 800 autres :
  ~180 k req/h, 50 req/s en moyenne, 100–150 req/s à l'ouverture US, depuis une seule IP** (les
  pénalités p-ticket sont liées à l'IP).
- **WebSockets sortants** : ~1 800 (1 200 users × ~1,5 compte) tenus en mémoire du process, un seul
  par user grâce à un bail Redis (TTL 30 s, renouvelé toutes les 10 s → ~120 ops Redis/s) ;
  heartbeat 2,5 s ≈ 720 trames/s ; ~50–150 Ko par socket TLS → 90–270 Mo. `ulimit` non défini.
  Backoff exponentiel 1 s → 60 s **sans jitter** : une coupure Tradovate fait reconnecter 1 800
  sockets en vagues synchrones ; un redéploiement de l'API déclenche ~1 200–1 800 `catchUp` complets
  simultanés (~15–20 k requêtes Tradovate en < 1 min) + autant d'`importTrades` complets en base.
- **Refresh tokens** : `getAccessToken` rafraîchit sous 40 min de marge, donc chaque connexion
  tourne toutes les ~40–45 min (~4 k appels `oauthtoken`/h sur un seul `client_id`). Refus
  `200 {"error":"invalid_token"}` bien détecté, 1 retry après 2 s. Verrou par login Redis
  `SET NX EX 30`, **mais** si le verrou est pris, le code attend 2 s puis rafraîchit **sans** verrou
  (`token-manager.ts:114-120`) ; `unlock` = `DEL` simple (pas de jeton propriétaire).
- **Import historique** : ni bloquant dans la requête ni en BullMQ : lancé en *fire-and-forget*
  dans le worker HTTP après le callback OAuth (`tradovate.controller.ts:164-174`), rattrapé par le
  cron à **2 par passage** (`FULL_BACKFILLS_PER_PASS`). 100 connexions dans l'heure = 100 imports
  concurrents non bornés, chacun `importTrades` ligne à ligne → risque de famine du pool ; perdus
  au redéploiement, rattrapés à ~48/jour — en concurrence avec l'archivage Tradovate à 10 jours.
- **429 / pénalités** : `p-ticket`/`p-time` traités comme `rate_limited` sur les GET, **non détectés**
  sur `oauthtoken` (classés « refus » → retry → possible `NEEDS_RECONNECT` à tort) ni sur le
  Reporting (**« mois vide » → trou d'historique définitif**) ; `p-captcha` jamais détecté ; aucun
  disjoncteur : après un 429 le WS, le cron et le bouton continuent d'appeler.
- **Multi-instances** : sockets et verrous sont cluster-safe via Redis, mais les crons tournent
  une fois **par conteneur**, et Redis indisponible = tous les verrous « ouverts ».

### 10.4 Compagnon de discipline temps réel

Mécanisme : **polling HTTP** (pas de SSE) + 2 WebSockets socket.io (`/eco` non authentifié,
`/tradovate-live`). `SessionStore` est `providedIn: 'root'` : le polling tourne sur **toutes** les
pages dès qu'une session est ACTIVE, y compris onglet masqué (sauf live-price).

| Appel | Période | Coût |
|---|---|---|
| `GET /market/live-price` (saisie rapide ouverte) | 4 s | Redis (TTL 3 s), miss = appel Yahoo/Binance/FMP sans single-flight |
| `GET /market/context` | 15 s | Redis (TTL 15 s = période), miss = 3 Yahoo + 1 FMP sans single-flight |
| `GET /session/today/stats` | 30 s | 1 `findMany` du jour, lignes complètes |
| `GET /auth/me` | 30 s (tous les users connectés) | 1 `findUnique` |
| `GET /eco-calendar/range` + `/pins` | 60 s | 5–7 `findMany` (1 par jour), **pas de cache** ; jour vide → appel FMP + upserts **sur le chemin user** |
| `GET /market/news` | 5 min | Redis, clé non triée |

Débit **[E]** : ~10 req/min/user sans live-price, ~25 avec → **170 à 420 req/s pour 1 000 users**
(mesuré au §3). Plus, à chaque publication d'un indicateur, `refresh-today` + N × `analyze-result`
par client connecté (**4–6 k requêtes en ~1 s** à 1 000 clients [E], non testé). État serveur :
Postgres + Redis ; seul l'état des WebSockets Tradovate est en mémoire, protégé par bail Redis ;
l'adapter Redis socket.io + `transports: ['websocket']` rend les sticky sessions inutiles. Derrière
Traefik : pas de timeout WS spécifique à régler (Traefik ne coupe pas les WS inactifs par défaut),
le heartbeat socket.io (25 s) suffit.

### 10.5 IA — voir §6.

### 10.6 API NestJS et process Node

- **Cluster** : `availableParallelism()` workers en prod (`main.ts:101-147`) ; 1 worker porte aussi
  les crons. Processors BullMQ et WebSockets Tradovate dans chaque worker HTTP : un job long occupe
  l'event loop d'un worker qui sert du HTTP.
- **Mémoire** : 587 Mo sans trafic pour 4 workers, ~114 Mo marginaux par worker (mesuré en prod,
  checklist du 30/09) ; `mem_limit: 1g`, pas de `--max-old-space-size`. Sous charge : voir §3.
- **Login** : `argon2id` m = 64 Mo, t = 3, p = 4 (`auth.service.ts:169`). Mesuré : **270 ms** médiane
  isolée, 64 Mo de RAM transitoire par vérification, exécuté dans le threadpool libuv (4 threads
  par worker) → un afflux de connexions à 15h30 est borné à ~15–25 logins/s sur 4 cœurs [E d'après M].
- **Import CSV** : `memoryStorage`, 5 Mo max par fichier, parsing synchrone (`split('\n')`,
  `XLSX.read`) — mesures §3.
- **Rate limiting** : global 60 req/min **par IP** (stockage Redis), IP + hash email sur `/auth/*`.
  Sans limite dédiée : `trades/import`, `debrief/generate`, PDF, `/admin/*`, `/vps/*`,
  `auth/refresh`. `health/ready` en `@SkipThrottle` (ping DB + Redis public). Un user avec la saisie
  rapide consomme ~25 req/min : 3 onglets ou collègues derrière un même NAT → 429.
- **Logs** : pas d'intercepteur par requête, JSON en prod, Sentry erreurs seulement
  (`tracesSampleRate: 0`) → volume faible ; rotation 3 × 50 Mo via `daemon.json` de l'hôte actuel
  (à recréer). `debrief.cron.ts:41-43` loggue tous les emails éligibles sur une ligne (PII).
- **Limites Docker** : `mem_limit` sur l'API seulement ; aucun `cpus`, aucun `ulimits` ; Postgres,
  Redis, Traefik hors dépôt.
- **Keep-alive** : défauts Node (5 s) derrière Traefik (90 s d'inactivité côté proxy) → 502
  sporadiques possibles ; poser `server.keepAliveTimeout = 95_000`, `headersTimeout = 96_000`.

### 10.7 Front et réseau

- **Bundles [M]** (`nx build app-mytradingcoach --configuration=production`) : initial **399 Ko
  brut / 106 Ko transférés** (budget 500 Ko respecté) ; 20 routes lazy, la plus grosse 496 Ko brut
  / 92 Ko ; total JS gzip -9 = **520 Ko**, dist 4,2 Mo.
- **Compression / cache** : nginx statique hors dépôt, non vérifiable ; aucun middleware
  `compress` Traefik. À faire : `gzip_static`/brotli pré-compressé, `Cache-Control: immutable` sur
  les fichiers hashés, `no-cache` sur `index.html`. L'API compresse (`compression()`).
- **Bande passante au pic** : voir §3 (débit mesuré par k6) ; assets : ~0,5 Mo par nouvelle
  session × 1 000 arrivées en 10 min ≈ 0,8 Mo/s [E].
- **DNS** : correctif `systemd-resolved` non documenté → prérequis §8.1.

### 10.8 Admin sur Vercel

- **Rôle ADMIN côté serveur : OK.** `@UseGuards(JwtAuthGuard, AdminGuard)` au niveau classe sur
  `admin.controller.ts:15`, `admin-users.controller.ts:26`, `admin-ambassadors.controller.ts:13`,
  `admin-broker-mappings.controller.ts:43`, `debrief-admin.controller.ts:10`, `vps.controller.ts:12` ;
  au niveau méthode sur `users.controller.ts:74-131`, `ambassador.controller.ts:50-71`, `referral`
  `admin/overview`, `eco-calendar fetch/:date`. Le rôle est relu en base à chaque requête. Le test
  `admin-routes.spec.ts` ne couvre que 3 contrôleurs sur 6.
- **Sécurité** : injection de commande `vps/docker.service.ts:84-91` (P0-4) ; route SSE de logs
  cassée (token en query non lu) et qui fuirait un `docker logs -f` par tiroir ouvert si réparée
  telle quelle.
- **Charge** : métriques = `count` + `EXISTS` indexés, ~100–400 ms à 10 k users [E] ; le dashboard
  admin sonde `vps/stats` (8 commandes SSH) et `docker/containers` (`docker stats --no-stream`,
  1–2 s de travail du démon) **toutes les 10 s sans filtre de visibilité** (`dashboard.component.ts:185-195`)
  → une admin ouverte en permanence coûte peu à la base mais sollicite l'hôte : 30 s + pause onglet
  masqué + cache Redis 10 s. Liste des users admin avec `_count` trades (`users.service.ts:204`) =
  même `GROUP BY` complet que P0-1.
- **CORS** : voir §8.6.

### 10.9 Résilience (hors capacité)

Le VPS-3 reste un point unique de défaillance (choix assumé).

| Scénario | RPO | RTO [E] |
|---|---|---|
| Perte du VPS-3, restauration de la sauvegarde auto OVH (quotidienne) | **≤ 24 h** (+ incohérence possible : snapshot disque d'un Postgres en cours d'écriture) | 1–2 h (restauration OVH + vérifs + DNS inchangé) |
| Perte du VPS-3, reconstruction sur une nouvelle machine depuis le `pg_dump` du VPS-1 | **≤ 24 h** (dump quotidien à 3h) | 3–5 h : provisioning + Docker + configs (**non versionnées** : Traefik, nginx, compose infra, `backup.sh`) + restauration (base 5–9 Go ≈ 15–30 min) + bascule DNS (TTL) |
| Corruption logique (mauvaise migration) | ≤ 24 h | 1–2 h |

Aujourd'hui : dumps sur le **même disque** que la base (`/opt/backups`), aucun runbook de
restauration, aucune alerte. Pour descendre le RPO à ~5 min sans HA : archivage WAL continu
(pgBackRest / wal-g) vers un Object Storage, et versionner les configs d'infra pour que le RTO ne
dépende pas de la mémoire de quelqu'un.

---

## 11. À ajouter aux agents `.claude/agents/` (pour validation, non appliqué)

- **`deploy.md`** : `mem_limit` réel = 1g (le fichier dit 512m) ; nombre de workers =
  `availableParallelism()` (pas « 4 » en dur) ; architecture cible VPS-3 / VPS-1 / Vercel ;
  correctif DNS `systemd-resolved` (1.1.1.1 + 9.9.9.9, OVH en repli) ; rotation des logs via
  `daemon.json` ; `ulimit nofile` ; budget RAM/CPU du §4 ; config Postgres/Redis/PgBouncer du §5 ;
  RPO/RTO du §10.9 ; `deploy.sh` est mort (vise un compose sans service `api`) ; outils
  `tools/load-tests/` et la règle « jamais contre la prod ».
- **`prisma.md`** : `connection_limit=1` est **sans effet** avec `PrismaPg` (c'est `pg.Pool.max`
  qui compte) ; **interdire `include: { _count: … }` sur une relation vers `Trade`** (Prisma 7 génère
  un `GROUP BY` sur toute la table) ; index à ajouter/retirer (§10.1) ; volumétrie mesurée
  (2,2 M trades ≈ 0,8 Go table + index).
- **`nestjs.md`** : `nestjs.md:540` dit 8 cœurs (4 en prod) ; « Pattern mis en cache 4 h » est faux
  (résultat Insights non persisté) ; le `cache_control` n'a aucun effet sous 1 024 tokens (Sonnet)
  / 4 096 (Haiku) ; tableau des crons à jour (éco : 6h + chaque minute 8h–17h + 18h30) ; règle
  « pas de `Promise.all` non borné dans un cron », « pas de `KEYS` Redis », « jamais d'appel
  externe sur le chemin d'une requête de polling » ; `AI_ENABLED` = seule garde IA fiable.
- **`security.md`** : injection de commande `/vps/docker/containers/:id` ; throttler par IP
  (collègues derrière un NAT) et IP+email contournable par rotation d'emails ; `health/ready`
  public sans limite ; gateway `/eco` non authentifiée ; PII (emails) dans les logs du cron debrief ;
  CORS admin Vercel (origine exacte, pas de `trim()`).
- **`plans.md`** : l'IA éco n'est **pas** indépendante du nombre d'users (clé = signature top-5
  actifs) ; le recap quotidien exclut les essais (`plan: 'PREMIUM'`) alors que le debrief les inclut
  (incohérence aux 4 points) ; coût IA estimé à 10 k users (§6) ; le coût de l'analyse éco du matin
  n'est pas loggé (FK `userId: 'shared'`).
- **`tests.md`** : existence et usage de `tools/load-tests/` (seed, k6, moniteur, analyse) ;
  `admin-routes.spec.ts` ne couvre que 3 contrôleurs admin sur 6.
