# PROMPT — Rendre MyTradingCoach capable d'encaisser 10 000 utilisateurs actifs

> **Pour l'agent qui exécute ce prompt.** Lis ce document en entier avant de toucher au code.
> Il a trois parties, à traiter **dans l'ordre** :
>
> - **Partie A** : les contrôles à faire sur le VPS et dans les consoles des services.
>   🤖 Ceux qui passent par SSH sont **exécutés par l'agent, en lecture seule**.
>   👤 Ceux qui passent par une console web (Resend, Anthropic, Tradovate…) restent à l'humain.
>   Leurs résultats conditionnent certaines tâches de la partie B.
> - **Partie B** : tous les correctifs **gratuits** (code, architecture, configuration du VPS).
> - **Partie C** : ce qui coûte de l'argent. **Ne rien acheter ni souscrire** : cette partie
>   sert à préparer une décision.
>
> Cahier des charges : `docs/audit-scalabilite-2026-09-30.md`. Les renvois « audit Cx / Hx »
> pointent vers ses constats.

---

## 0. Rôle, objectif et dimensionnement cible

Tu es un développeur senior back-end / SRE (NestJS 11, Prisma 7, PostgreSQL 17, PgBouncer,
Redis 7.4, BullMQ, socket.io, Docker, Traefik, Angular 22).

**Objectif :** encaisser **10 000 utilisateurs actifs** après le référencement dans
l'écosystème NinjaTrader (~800 000 traders exposés), sans coupure ni perte de données, sur
l'infrastructure existante tant que c'est possible.

**Hypothèses de dimensionnement.** Toute tâche de performance se valide contre ces chiffres :

| Grandeur | Cible |
|---|---|
| Utilisateurs actifs (se connectent dans le mois) | 10 000 |
| Connectés simultanément au pic (heures de marché US) | **1 500** |
| Débit API soutenu au pic | **500 req/s**, p95 < 300 ms, 0 % d'erreurs 5xx |
| Pic d'inscriptions (jour J du référencement) | **300 / heure**, dont 30 dans la même minute |
| Trades par utilisateur actif | médiane 2 000, max 50 000 (scalpers) |
| Connexions Tradovate actives | 2 000 |
| Sockets ouverts simultanément | 1 500 |

**Situation de départ** (mesurée le 30/09) :
- VPS OVH : 4 vCPU, 7,7 Go de RAM.
- `mtc_api_prod` : 587 Mo sur 1 Gio au repos.
- Postgres : `max_connections = 50`. PgBouncer : pools de 25 × 3 bases.
- Prod, dev et beta partagent Postgres, PgBouncer, Redis et le VPS.

---

## 1. Sources à lire AVANT de coder

| Fichier | Pourquoi |
|---|---|
| `CLAUDE.md` | Règles globales (pnpm, commits, compte démo, plans) |
| `docs/audit-scalabilite-2026-09-30.md` | **Le cahier des charges** : chaque tâche y renvoie |
| `docs/pre-launch-checklist-newsletter-2026-09-30.md` | Mesures réelles du VPS |
| `.claude/agents/deploy.md` | Infra, compose, CD, sauvegardes |
| `.claude/agents/nestjs.md` · `prisma.md` · `security.md` · `angular.md` · `tests.md` | Règles du domaine touché |
| `.claude/agents/plans.md` | Si une tâche touche au gating FREE / PREMIUM ou aux quotas IA |

---

## 2. Règles non négociables

1. **pnpm uniquement** (`pnpm`, `pnpm exec`, `pnpm dlx`). Jamais `npm` ni `npx`.
2. **Builder et tester après chaque tâche** : zéro erreur avant la suivante (commandes en § 5).
3. **Un commit atomique par tâche**, avec son ID : `perf(api): import de trades par lots [SCA-B1-01]`.
4. **Aucun changement fonctionnel visible**, sauf si la tâche le demande. Un utilisateur doit
   voir les mêmes chiffres avant et après. Toute réécriture d'agrégat (SQL au lieu de JS)
   exige un **test d'équivalence** : mêmes entrées, même sortie à 1 centime près.
5. **Ne jamais désactiver, sauter ou supprimer un test** pour obtenir du vert.
6. **Compte démo.**
   - Les nouvelles mutations sont déjà bloquées par `DemoReadOnlyGuard`.
   - Tout nouveau cron, file ou agrégat ciblant des users exclut `isDemo: true`.
   - La démo doit continuer d'afficher des données.
7. **Aucune valeur de prix modifiée.** Aucun changement de gating sans suivre `plans.md`.
8. **Toute nouvelle variable d'environnement a une valeur par défaut sûre.** Elle est ajoutée à
   `src/config/env.ts` et documentée dans `.claude/agents/deploy.md`. Sans la variable, le
   comportement reste celui d'aujourd'hui.
9. **Jamais de secret dans le dépôt, les logs ou le rapport.** Les commandes de la partie A
   masquent les mots de passe.
10. **Mettre à jour l'agent concerné** (`.claude/agents/*.md`) dès qu'une règle change.
    Corriger au passage `nestjs.md` (« 8 cœurs sur le VPS actuel » : il y en a **4**) et le
    commentaire de `prisma.service.ts:23` (« limite PG: 100 » : elle est de **50**).
11. **Logger NestJS**, pas de `console.log`. Pas de PII (e-mails) dans les logs.
12. **VPS : lecture libre, écriture sur validation.** L'agent a un accès SSH au VPS.
    - **Partie A** : uniquement des commandes de lecture (liste blanche au début de la partie A).
    - **Toute modification** (fichier de config, `sysctl`, `docker compose up/down/restart`,
      `CONFIG SET`, `ALTER SYSTEM`, suppression, écriture en base) : l'agent montre la commande
      exacte et sa procédure de retour arrière, puis **attend un « oui » explicite** de
      l'utilisateur pour **ce** bloc. Une validation ne vaut pas pour le bloc suivant.
    - **Jamais sur la prod** pendant les heures de marché US (15 h 30 – 22 h, heure de Paris),
      sauf urgence validée.
    - **Jamais** d'écriture dans la base `mytradingcoach_prod`, sauf les migrations Prisma
      passées par le CD.

---

## 3. Méthode de travail

1. **Une phase = une branche = une PR.** Nom de branche : `perf/scale-<phase>-<slug>`.
2. Traite les tâches dans l'ordre. Chaque tâche indique **où**, **quoi** et **« terminé quand »**.
3. Une tâche marquée **⛔ dépend de A-xx** attend le résultat du contrôle. Sans réponse, applique
   le **choix par défaut** indiqué et signale-le.
4. **Si une tâche touche plus de 15 fichiers** ou change un contrat d'API public : arrête-toi et demande.
5. **Si un constat de l'audit est faux ou déjà corrigé** : ne force rien, note-le dans le rapport.
6. Rapport de fin de phase au format du § 8.

---

# PARTIE A — Contrôles de l'environnement réel

> - **🤖 A-01 → A-05, A-07** : exécutés par l'agent via SSH (`ssh greg@<VPS>`), **en lecture seule**.
> - **👤 A-06** : consoles web des services. L'agent pose les questions à l'humain et note les réponses.
>
> **Livrable :** `docs/ops/controle-vps-<AAAA-MM-JJ>.md`. Il contient, pour chaque contrôle :
> - la commande lancée ;
> - la sortie, **secrets masqués** ;
> - l'interprétation en une ou deux phrases ;
> - la conséquence sur les tâches de la partie B : choix confirmé ou modifié.
>
> Committé sur la branche `perf/scale-a-controles`. **L'agent ne commence la partie B qu'une fois
> ce fichier écrit.**

### Garde-fous SSH (non négociables)

**Autorisé** — lecture seule :
- `cat`, `ls`, `grep`, `head`, `tail`, `find`, `df`, `free`, `nproc`, `uptime`, `sysctl` sans `-w`,
  `crontab -l`, `ulimit` ;
- `docker ps`, `docker stats --no-stream`, `docker inspect`, `docker logs --tail`,
  `docker exec … <commande de cette liste>` ;
- `psql` avec `PGOPTIONS='-c default_transaction_read_only=on'` : uniquement `SELECT` et `SHOW` ;
- `redis-cli` : uniquement `INFO`, `CONFIG GET`, `DBSIZE`, `SCAN`/`--scan`, `TYPE`, `TTL`, `LLEN`, `XLEN`.

**Interdit dans la partie A :**
- `KEYS` : bloque Redis en prod ;
- `FLUSH*`, `DEL`, `CONFIG SET`, `SET` ;
- `docker compose up/down/restart/build`, `docker rm`/`stop`/`kill`, `docker system prune` ;
- `ALTER`, `UPDATE`, `DELETE`, `INSERT` ;
- tout `sudo`, toute écriture de fichier sur le VPS, toute installation de paquet.

**Secrets :**
- ne jamais afficher un fichier `.env` en entier ;
- filtrer les variables par nom et masquer leurs valeurs, avec les `sed` des commandes ci-dessous ;
- ne recopier aucun mot de passe, token, clé ou DSN dans le livrable ni dans le chat.

**Tout le reste :**
- une commande hors liste, ou un doute : **arrêter et demander** ;
- une commande qui échoue (nom de conteneur différent, chemin absent) : chercher l'équivalent en
  lecture (`docker ps`, `ls`) et adapter, sans rien modifier.

### 🤖 A-01 🔴 Isolation Redis entre prod, dev et beta (audit C6) — le plus urgent

Si les 3 environnements utilisent la même base Redis sans préfixe, les workers dev/beta
peuvent consommer les jobs Stripe de la prod.

```sh
# Variables Redis de chaque environnement (mot de passe masqué)
for e in prod dev beta; do echo "== $e"; grep -hE '^REDIS_' /opt/apps/mytradingcoach/$e/.env.* \
  | sed -E 's/(PASSWORD=).*/\1***/; s#(://:)[^@]*@#\1***@#'; done

# État de Redis
docker exec mtc_redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO keyspace'
docker exec mtc_redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning CONFIG GET maxmemory*'
docker exec mtc_redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO memory' | grep -E 'used_memory_human|maxmemory_human'
docker exec mtc_redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "bull:*" | cut -d: -f1-3 | sort | uniq -c'
```

**À rapporter :** `REDIS_DB` (ou son absence) par environnement, `maxmemory`,
`maxmemory-policy`, la mémoire utilisée, les files BullMQ présentes (`bull:stripe:*`…).
**Débloque :** SCA-B0-01.

### 🤖 A-02 Postgres et PgBouncer (audit C5)

```sh
docker exec mtc_pgbouncer sh -c 'cat /etc/pgbouncer/pgbouncer.ini 2>/dev/null || env | grep -i -E "pool|max_|mode"' | grep -v -i pass
docker exec -e PGOPTIONS='-c default_transaction_read_only=on' mtc_postgres psql -U mtc_user -d postgres -c "SELECT version();" \
  -c "SHOW max_connections;" -c "SHOW shared_buffers;" -c "SHOW work_mem;" \
  -c "SHOW effective_cache_size;" -c "SHOW random_page_cost;" \
  -c "SELECT datname, count(*) FROM pg_stat_activity GROUP BY 1;" \
  -c "SELECT * FROM pg_available_extensions WHERE name='pg_stat_statements';"
# Version de PgBouncer (>= 1.21 requis pour les prepared statements en mode transaction)
docker exec mtc_pgbouncer pgbouncer --version 2>/dev/null || docker inspect mtc_pgbouncer --format '{{.Config.Image}}'
```

**À rapporter :** la sortie, et le chemin du `docker-compose.yml` de `/opt/infra/databases/`.
**Débloque :** SCA-B0-05, SCA-B7-02.

### 🤖 A-03 Volumétrie réelle (dimensionne les tâches B1 / B2)

```sh
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' mtc_postgres \
  psql -U mtc_user -d mytradingcoach_prod <<'SQL'
SELECT count(*) FILTER (WHERE NOT "isDemo") AS users, count(*) FILTER (WHERE plan='PREMIUM' AND NOT "isDemo") AS premium FROM "User";
SELECT percentile_cont(ARRAY[0.5,0.9,0.99]) WITHIN GROUP (ORDER BY n) AS p50_p90_p99, max(n)
  FROM (SELECT count(*) n FROM "Trade" GROUP BY "userId") t;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)), n_live_tup
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;
SELECT count(*), status FROM "BrokerConnection" GROUP BY status;
SQL
```

Les requêtes ne renvoient que des agrégats : aucune donnée personnelle ne doit apparaître
dans le livrable.

**À rapporter :** la sortie brute.

### 🤖 A-04 Ressources de l'hôte et limites système

```sh
nproc; free -h; df -h /; swapon --show; uptime
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
sysctl net.core.somaxconn net.ipv4.tcp_max_syn_backlog fs.file-max vm.swappiness vm.overcommit_memory
docker exec mtc_api_prod sh -c 'ulimit -n'
cat /etc/docker/daemon.json
docker exec mtc_traefik traefik version 2>/dev/null; ls /opt/infra/traefik/
```

**À rapporter :** la sortie, et le contenu de la config statique Traefik (`traefik.yml` ou
les `command:` du compose, sans secrets).
**Débloque :** SCA-B7-01, SCA-B7-04.

### 🤖 A-05 Config nginx des fronts (cache, compression)

```sh
ls /opt/infra/static/nginx/ && cat /opt/infra/static/nginx/*.conf
curl -sI https://app.mytradingcoach.app/ | grep -i -E 'cache-control|content-encoding'
curl -sI -H 'Accept-Encoding: gzip, br' "https://app.mytradingcoach.app/$(curl -s https://app.mytradingcoach.app/ | grep -oE 'main-[A-Z0-9]+\.js' | head -1)" | grep -i -E 'cache-control|content-encoding'
curl -sI https://www.mytradingcoach.app/ | grep -i -E 'cache-control|content-encoding'
```

**Débloque :** SCA-B7-03.

### 👤 A-06 Quotas des services tiers (consoles web)

L'agent **pose ces questions à l'utilisateur** en une seule fois. Il peut vérifier seul, en
lecture, la **présence** des variables (`grep -c '^SENTRY_DSN=' .env.production`), jamais
leur valeur.

| # | Service | Quoi relever | Pourquoi |
|---|---|---|---|
| A-06a | **Resend** | Plan, quota **jour** et **mois**, limite req/s, domaine vérifié | En offre gratuite (100/jour), le plafond est d'environ 50 inscriptions/jour, et les suivantes perdent leurs e-mails **en silence** |
| A-06b | **Anthropic** | Tier de l'organisation (RPM / ITPM / OTPM par modèle), plafond de dépense mensuel | Dimensionne le sémaphore IA (SCA-B5-06) et les files |
| A-06c | **Tradovate** | Limites par application ou par IP : WebSockets simultanés, req/s, règles `p-ticket` / pénalités. **Écrire au support partenaire** si ce n'est pas documenté | 2 000 connexions depuis une seule IP de VPS peuvent être bloquées |
| A-06d | **Données de marché (FMP ou autre)** | Plan, appels / minute et / jour | Prix toutes les 4 s × utilisateurs |
| A-06e | **Sentry** | Existence d'un projet et d'un DSN ; quota de l'offre | Aucun suivi d'erreurs en prod aujourd'hui |
| A-06f | **GitHub** | Plan du compte ; stockage Packages (GHCR) inclus pour un dépôt privé | Tâche SCA-B8-01 (images taguées) |
| A-06g | **OVH** | Nom exact de l'offre VPS, bande passante, options snapshot et backup, anti-DDoS | Partie C |
| A-06h | **NinjaTrader** | Date et canal de la mise en avant, audience estimée | Planifier le gel des déploiements et la montée en charge |

### 🤖 A-07 Plan de reprise

```sh
ls -la /opt/backups/mtc/ | tail -5; crontab -l
```

**À rapporter :** la sortie. Indique aussi si une restauration a déjà été testée (oui / non).

### Choix par défaut si un contrôle est impossible ou reste sans réponse

| Contrôle | Défaut appliqué par l'agent |
|---|---|
| A-01 | Considérer Redis **partagé** → isoler par préfixe (SCA-B0-01) |
| A-02 | PgBouncer < 1.21 → garder le mode sans prepared statements nommés |
| A-03 | Médiane 2 000, max 50 000 trades par user |
| A-06a | Resend gratuit → limiter à 1 e-mail/s, supprimer l'alerte admin par inscription |
| A-06b | Tier 2 → au plus 4 appels IA simultanés dans tout le cluster |
| A-06c | Inconnu → au plus 5 synchronisations Tradovate simultanées, jitter à la reconnexion |

---

# PARTIE B — Correctifs gratuits

> Tout ce qui suit coûte 0 € : du code, de la configuration, des outils open source, ou des
> offres gratuites. Ordre : **B0 avant le référencement**, puis B1 → B9.

## 4. Phases

### PHASE B0 — Urgences avant le référencement (config et petits correctifs)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B0-01 ⛔A-01 | `modules/infra/redis.service.ts`, `app.module.ts` (BullMQ), `common/adapters/redis-io.adapter.ts`, throttler storage, `config/env.ts` | Nouvelles variables `REDIS_DB` (défaut `0`) et `REDIS_PREFIX` (défaut vide = comportement actuel). `keyPrefix` ioredis + `prefix` BullMQ + clé du canal socket.io. Les files BullMQ passent en `removeOnFail: { age: 604800, count: 1000 }`. `deploy.md` recommande prod `db 0`, dev `db 1`, beta `db 2` | Tests : deux instances à préfixes différents ne voient pas les jobs l'une de l'autre. Changement de `.env.dev` / `.env.beta` sur le VPS appliqué après validation (règle 12) |
| SCA-B0-02 | `main.ts:102`, `docker-compose.prod.yml` (et beta, dev) | Nombre de workers = `WEB_CONCURRENCY`, défaut `min(availableParallelism(), 3)`. Compose : `NODE_OPTIONS=--max-old-space-size=384`, `mem_limit: 2g`, `memswap_limit: 2g`, `stop_grace_period: 30s`. Healthcheck sur `/api/health/ready` | Build OK. Le log de démarrage affiche le nombre de workers et le plafond de tas |
| SCA-B0-03 | `auth/auth.service.ts:86,169,254`, `admin/demo-seed.ts:40` | Constante partagée `ARGON2_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }`. À la connexion, si `argon2.needsRehash(hash, opts)`, rehacher et enregistrer | Test : un hash ancien paramètre se vérifie **et** est remplacé ; un nouveau hash porte `m=19456` |
| SCA-B0-04 | `common/throttler/email-aware-throttler.guard.ts`, `auth/auth.controller.ts:43,95` | Second limiteur **IP seule** en plus de la clé IP+e-mail : `register` 10/h/IP, `forgot-password` 10/h/IP, `login` 30/10 min/IP | Test : 11 inscriptions depuis une IP avec 11 e-mails distincts → la 11ᵉ reçoit 429 |
| SCA-B0-05 ⛔A-02 | `prisma/prisma.service.ts:20-25`, `config/env.ts` | `max` du pool = `DB_POOL_MAX` (défaut `5`), `connectionTimeoutMillis: 5000`, `idleTimeoutMillis: 10000`, `statement_timeout: 15000`. Rapport : un bloc `pgbouncer.ini` proposé (`[databases]` avec `pool_size=25` prod, `5` dev, `5` beta ; `max_db_connections` ; `reserve_pool_size=5`) pour application manuelle | 3 workers × 5 = 15 connexions client max. Commentaire corrigé |
| SCA-B0-06 | `pdf/pdf.service.ts`, `debrief/debrief.controller.ts:39` | Un seul navigateur réutilisé par process (lancé à la demande, fermé après 5 min d'inactivité ou 200 PDF) ; sémaphore de 1 PDF à la fois par process ; `page.pdf({ timeout: 20000 })` ; cache Redis du PDF (clé user + semaine, TTL 7 j). **Échapper** les textes IA et utilisateur des templates (`pdf.service.ts:81-110`) | Test : 5 requêtes simultanées → 1 seul `launch`. Test d'échappement (`<script>` rendu en texte) |
| SCA-B0-07 | `auth/auth.service.ts:144,151` | Supprimer l'e-mail admin par inscription. Le remplacer par un digest quotidien (cron existant ou nouveau, qui exclut `isDemo`) | Une inscription = 1 seul e-mail envoyé |
| SCA-B0-08 | `.github/workflows/cd.yml:46-68` | `deploy-api` dépend du job `changes` et ne tourne que si `api-mytradingcoach`, `prisma` ou `libs/*` sont affectés. Après `up`, attendre jusqu'à 90 s que `/api/health/ready` réponde 200, sinon faire échouer le job. Ajouter un `workflow_dispatch` avec un input `freeze` documenté | Un commit landing seul ne redéploie pas l'API |
| SCA-B0-09 | `instrument.ts`, `config/env.ts` | Sentry activé si `SENTRY_DSN` est présent (offre gratuite) : `sampleRate: 1`, `tracesSampleRate: 0`, `environment` et `release` = SHA | Doc `deploy.md` : où mettre le DSN |
| SCA-B0-10 | nouveau `tools/load/` | Scripts **k6** (open source) : `smoke.js` (1 VU), `signup-wave.js` (30 inscriptions/min), `peak.js` (montée à 1 500 VU : login, dashboard, journal, `/auth/me`, `/public/stats`, polling de session). Cible par variable `BASE_URL`, **jamais la prod par défaut**. README : lancement contre **beta** avec `docker stats` en parallèle | `pnpm dlx` n'est pas requis : k6 est un binaire. Le README donne la commande Docker `grafana/k6` |

### PHASE B1 — Import de trades et cache (audit C7)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B1-01 | `trades/trades.service.ts:170-245` | Sortie immédiate si `dtos.length === 0`. Déduplication limitée à `tradedAt` ∈ [min − 1 j, max + 1 j] du lot, avec `select` minimal | Une sync Tradovate vide = 0 requête Trade |
| SCA-B1-02 | idem | Résoudre setups, sessions et comptes **une fois par lot** (maps en mémoire). Calcul d'exécution en pur. Insertion par `createMany({ data, skipDuplicates: true })` par tranches de 500, `importHash` inchangé | Test d'équivalence : même CSV → mêmes trades, mêmes P&L, mêmes compteurs `created/duplicates/failed`. Import de 5 000 lignes < 5 s en test d'intégration |
| SCA-B1-03 | `analytics/analytics.service.ts:38-43` et tous les appelants de `invalidateUserCache` | Supprimer `KEYS`. Cache versionné : `analytics:v:<uid>` (compteur), les clés incluent la version, l'invalidation fait `INCR`. Les anciennes clés expirent par TTL. Invalidation **une fois** en fin d'import | `grep -rn "\.keys(" apps/api-mytradingcoach/src` = 0 résultat hors tests |
| SCA-B1-04 | `trades/trades.controller.ts:81` | Import limité à 5/min par utilisateur | Test 429 |

### PHASE B2 — Agrégats en SQL (audit C8)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B2-01 | `analytics/analytics.service.ts:97,211,254,290,321,357,484` | Réécrire les 7 calculs en `groupBy` / `aggregate` / `$queryRaw` paramétré : `SUM(pnl - COALESCE(commission,0))`, `COUNT(*) FILTER (WHERE …)`, `date_trunc('day', "tradedAt" AT TIME ZONE 'Europe/Paris')`, drawdown et equity par `SUM() OVER (ORDER BY day)`. L'equity curve « par trade » est plafonnée (échantillonnage au-delà de 2 000 points) | **Test d'équivalence** ancien vs nouveau calcul sur un jeu de 5 000 trades aléatoires (fixtures seedées), écart ≤ 0,01 |
| SCA-B2-02 | `trades/trades.service.ts:293` (`computeJournalStats`) | Même réécriture SQL, mêmes filtres | Test d'équivalence |
| SCA-B2-03 | `accounts/accounts.service.ts:74` (`list`) | Totaux par compte en un `groupBy`, pic d'equity en SQL fenêtré, mis en cache (clé versionnée B1-03) | Test d'équivalence |
| SCA-B2-04 | `users/users.service.ts:511`, `trades.service.ts:251,261`, `session/session.service.ts:267` | `aggregate` au lieu de charger les trades ; doublons en `GROUP BY … HAVING count(*) > 1` ; `select` minimal | — |
| SCA-B2-05 | `prisma/schema.prisma` + migration | Ajouter `Trade @@index([accountId, tradedAt])`, `User @@index([isDemo, lastSeenAt])`, `User @@index([createdAt])`. Supprimer les `@@index` redondants avec un `@@unique` (DailyRecap, UserDailyActivity, EcoCalendarCache, EcoAnalysisCache, MetricsSnapshot). Si la table Trade dépasse 1 M lignes (A-03), migration SQL en `CREATE INDEX CONCURRENTLY` | `prisma migrate diff` propre ; `prisma.md` mis à jour |

### PHASE B3 — Coût de chaque requête (audit H2, H3, moyens)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B3-01 | `auth/jwt.strategy.ts:21` | Cache du user authentifié : Redis 60 s (clé versionnée par user), invalidé à tout changement de plan, rôle, `isDemo`, suppression, mot de passe | Test : changer le plan → effet immédiat |
| SCA-B3-02 | `common/interceptors/presence.interceptor.ts` | Remplacer la `Map` locale par Redis `SET presence:<uid> 1 NX EX 60` ; n'écrire `lastSeenAt` que si le SET réussit | 1 écriture/min/user quel que soit le nombre de workers |
| SCA-B3-03 | throttler global | Tracker = `user:<id>` si authentifié, IP sinon. Limite authentifiée 300/min/user | Deux users derrière la même IP ne partagent plus de compteur |
| SCA-B3-04 | `trades/market-data.service.ts:114,232,253,271,288,321`, `eco-calendar/eco-calendar.service.ts:55`, `discord/discord.service.ts:38` | `AbortSignal.timeout(5000)` sur chaque `fetch`. Single-flight par clé (verrou Redis `NX PX 5000`, les autres attendent le cache) ; stale-while-revalidate pour les prix | Test : 50 appels simultanés sur une clé froide → 1 seul appel sortant |
| SCA-B3-05 | `market-data.service.ts:173` (`ensureNewsTextFr`) | Verrou Redis par news : une seule traduction IA | Idem |
| SCA-B3-06 | `main.ts:30` | `rawBody` uniquement pour la route webhook Stripe | Le test du webhook Stripe passe |
| SCA-B3-07 | `public/public.controller.ts` | `Cache-Control: public, max-age=300, stale-while-revalidate=600` sur `/public/stats` | En-tête présent |

### PHASE B4 — Front : moins d'appels par onglet (audit H1, M1, M2)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B4-01 | `core/auth/auth.service.ts:71` | `/auth/me` toutes les 5 min, et au retour de focus si > 5 min | — |
| SCA-B4-02 | `core/stores/session.store.ts:93-124`, `core/constants/polling.const.ts` | Utilitaire partagé `visibleInterval(ms)` qui suspend quand `document.hidden` et relance au retour. Tous les pollings l'utilisent | Test unitaire : pas d'appel onglet caché |
| SCA-B4-03 | `session.store.ts`, gateway `/eco` | Contexte marché et calendrier éco **poussés** par le socket `/eco` (données communes à tous). Le polling reste en secours à 5 min | Moins de 3 req/min/onglet en session, hors quick-trade |
| SCA-B4-04 | `features/dashboard/dashboard.component.ts:201-222,358-396` | Ne pas recharger les analytics au premier passage « non chargé → chargé » des stores | ≤ 8 requêtes à l'ouverture du dashboard (mesuré dans un test e2e ou avec un intercepteur de test) |
| SCA-B4-05 | `features/dashboard/services/session-data.service.ts` | Supprimer (code mort, jamais injecté) | — |
| SCA-B4-06 | `app.config.ts:34` | Remplacer `PreloadAllModules` par un préchargement des routes du menu principal seulement | — |
| SCA-B4-07 | `eco-socket.service.ts:15`, `tradovate-live-socket.service.ts:48` | Reconnexion avec délai initial aléatoire 1–10 s puis backoff jusqu'à 60 s (évite la tempête après un déploiement) | — |

### PHASE B5 — Crons, files et travaux lourds (audit H4 → H8, H11)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B5-01 | `daily-recap/daily-recap.cron.ts:35`, `resend/resend.cron.ts:36` | Remplacer `Promise.all` par une file BullMQ (modèle : `debrief.cron.ts`), `concurrency: 3`, `jobId` idempotent (user + jour) | Le cron n'attend plus les envois ; aucun doublon si relancé |
| SCA-B5-02 ⛔A-06a | `resend/resend.service.ts:268-276` | Tous les envois passent par une file `email` avec `limiter: { max: <quota/s>, duration: 1000 }`, 5 tentatives, backoff exponentiel sur 429 et 5xx. Plus aucun e-mail perdu en silence | Test : un 429 simulé → nouvel essai |
| SCA-B5-03 | `integrations/tradovate/tradovate-background-refresh.cron.ts:56,97` | Verrou Redis « passe en cours » (TTL = période), 1 job BullMQ par connexion avec `concurrency: 5` (⛔A-06c), passe « avec historique » étalée sur l'heure (hash de l'id modulo 4) | Une passe ne démarre jamais tant que la précédente tourne |
| SCA-B5-04 | `trades/behavioral-grades.ts:14-84` et ses 5 appelants | Recalcul asynchrone : job BullMQ par compte, dédupliqué (`jobId = accountId`, délai 5 s). Fenêtre limitée aux trades touchés ± 1 jour. Mise à jour en un `UPDATE … FROM (VALUES …)` | Test d'équivalence des notes sur un compte de 2 000 trades |
| SCA-B5-05 | `trades/csv-import.service.ts:421` | Parsing xlsx/CSV dans un `worker_thread` (pool de 1 par process) avec timeout 20 s et `sheetRows: 10001` | Un fichier piège (zip bomb) échoue proprement sans bloquer l'event loop |
| SCA-B5-06 ⛔A-06b | `ai/ai.service.ts:543-576`, `infra/anthropic-client.service.ts` | Sémaphore Redis global sur les appels Anthropic (défaut 4). Quota mensuel atomique (`INCR` puis comparaison, décrément si refus). Sur 429 : backoff avec respect de `retry-after`. Prompt caching activé sur les system prompts longs s'il ne l'est pas | Test : quota respecté sous 20 appels concurrents |
| SCA-B5-07 | `resend/crons/auto-campaigns.cron.ts:36-55`, `email-dispatch.service.ts:49,62` | Une requête par campagne, `NOT EXISTS` sur `EmailSend`, lecture par curseur de 500 | Plus de N+1 |
| SCA-B5-08 | `debrief/debrief.cron.ts:42`, `debrief.service.ts:316` | Ne plus journaliser les e-mails. N'enfiler que les users ayant tradé dans la semaine | — |
| SCA-B5-09 | nouveau cron mensuel (worker cron) | Rétention : `AiUsageLog` > 13 mois (après agrégation quotidienne), `StripeEvent` > 90 j, `MarketNews` > 30 j, `EmailSend` > 12 mois, `UserDailyActivity` > 24 mois. Suppression par lots de 5 000 | `prisma.md` documente la rétention |

### PHASE B6 — Architecture : séparer les rôles (audit H7, H9, H10)

| ID | Où | Quoi | Terminé quand |
|---|---|---|---|
| SCA-B6-01 | `main.ts`, `app.module.ts`, nouveau `docker-compose.prod.yml` service `worker` | Rôle par variable `APP_ROLE=web|worker|all` (défaut `all` = comportement actuel). `web` : HTTP et sockets, **aucun** cron ni processeur BullMQ. `worker` : crons, processeurs BullMQ, temps réel Tradovate sortant ; pas de route Traefik ; `mem_limit: 1g`. Le cluster web n'a plus de worker cron | En local, `APP_ROLE=web` + `APP_ROLE=worker` = mêmes fonctionnalités qu'`all` |
| SCA-B6-02 | `integrations/tradovate/tradovate-live.service.ts:106-119` | `catchUp` sous p-limit 5 par process ; bail Redis gardé 60 s après une déconnexion (pas de nouvelle ouverture si le client revient vite) | Redémarrage simulé de 200 clients → au plus 5 catchUp simultanés |
| SCA-B6-03 | `eco-calendar/eco-calendar.gateway.ts:12,29-34` | Authentification JWT au handshake, logs de connexion en `debug`, `maxHttpBufferSize: 1e5`, `pingInterval: 25000` | Un socket sans jeton est refusé |
| SCA-B6-04 | `main.ts` | Arrêt propre : sur SIGTERM, fermer le serveur HTTP (`server.close`), attendre 20 s au plus les requêtes en cours, puis fermer les sockets | — |

### PHASE B7 — VPS et configuration (gratuit ; appliqué via SSH après validation)

> Méthode pour chaque bloc :
> 1. L'agent **versionne** la config dans `infra/` du dépôt (nouveau dossier).
> 2. Il sauvegarde l'existant sur le VPS en lecture (`cp x x.bak-<date>`, montré avant).
> 3. Il présente le diff, la commande d'application et la procédure de retour arrière.
> 4. Il **attend un « oui » explicite** (règle 12), applique, puis vérifie.
>
> Un bloc à la fois, jamais pendant les heures de marché US.

| ID | Quoi | Détail |
|---|---|---|
| SCA-B7-01 ⛔A-04 | Réglages système | `net.core.somaxconn=4096`, `net.ipv4.tcp_max_syn_backlog=4096`, `net.ipv4.ip_local_port_range=10240 65535`, `vm.swappiness=10`, `fs.file-max=200000` dans `/etc/sysctl.d/99-mtc.conf`. `ulimits: nofile: 65536` dans les compose API et Traefik |
| SCA-B7-02 ⛔A-02 | Postgres tuning (pour ~2 Go de RAM dédiés) | `shared_buffers=1GB`, `effective_cache_size=3GB`, `work_mem=16MB`, `maintenance_work_mem=256MB`, `random_page_cost=1.1`, `max_connections=100`, `shared_preload_libraries=pg_stat_statements`, `log_min_duration_statement=500`. PgBouncer : bloc du SCA-B0-05. Mémoire du conteneur Postgres plafonnée |
| SCA-B7-03 ⛔A-05 | nginx des fronts | `index.html` en `no-cache` ; fichiers hashés (`*.js`, `*.css`, `/_astro/`) en `public, max-age=31536000, immutable` ; `gzip on` + `gzip_static on` (fichiers `.gz` pré-générés dans cd.yml) ; `open_file_cache`. Versionner ces confs dans `infra/nginx/` |
| SCA-B7-04 ⛔A-04 | Traefik | Middleware `compress` sur l'API ; `respondingTimeouts` / `serversTransport` adaptés aux sockets ; rate limit Traefik de secours sur `/api/auth/*` (`average: 20, burst: 40` par IP) ; `accessLog` bufferisé |
| SCA-B7-05 ⛔A-01 | Redis | `maxmemory 512mb`, `maxmemory-policy noeviction` **si** BullMQ y vit (obligatoire pour BullMQ), `appendonly yes`, `appendfsync everysec`. Un `db` par environnement (SCA-B0-01) |
| SCA-B7-06 | Jour J | Procédure écrite dans `deploy.md` : arrêter `mtc_api_beta` et `mtc_api_dev` (≈ 1,2 Go libérés), geler les déploiements API, surveiller `docker stats` + Sentry + uptime |
| SCA-B7-07 | Déplacer dev et beta | Tant qu'aucun second VPS n'existe (partie C), dev et beta ne tournent **que sur demande** (`docker compose up` le temps d'un test), pas en permanence |
| SCA-B7-08 | Supervision gratuite | UptimeRobot ou Better Stack (offre gratuite) sur `/api/health/ready`, `app.`, `www.`. Script cron `docker events`/`docker ps` qui alerte (e-mail Resend ou webhook Discord **valide**) si un conteneur `mtc_*` redémarre. Node exporter + Grafana Cloud (offre gratuite) si souhaité |
| SCA-B7-09 | Sauvegarde hors-site gratuite | `restic` vers **Backblaze B2** (10 Go gratuits) ou OVH Object Storage, chiffré, rétention 14 j + 8 hebdo. Test de restauration documenté dans `deploy.md` (restaurer dans une base `mtc_restore_test`, compter les trades) |
| SCA-B7-10 | Nettoyage | Supprimer `deploy.sh` (obsolète) et `vercel.json` des apps Angular |

### PHASE B8 — Déploiement sans coupure (gratuit)

| ID | Où | Quoi |
|---|---|---|
| SCA-B8-01 ⛔A-06f | `cd.yml`, compose prod | Image construite **en CI** (plus sur le VPS) et taguée par SHA. Registre : GHCR si le quota le permet ; sinon `docker save \| ssh docker load`. Le compose lit `image: …:${API_TAG}` |
| SCA-B8-02 | compose prod, `entrypoint.sh` | Migrations **hors démarrage** : `docker compose run --rm api migrate` avant le basculement ; `entrypoint.sh` ne migre plus que si `RUN_MIGRATIONS=true`. Règle écrite dans `prisma.md` : migrations **compatibles N-1** (on ajoute d'abord, on supprime au déploiement suivant) |
| SCA-B8-03 | compose prod + labels Traefik | Blue/green : `api_blue` et `api_green` sur le même service Traefik. Le déploiement démarre la couleur inactive, attend `/api/health/ready`, arrête l'ancienne après 30 s de drain. Script `infra/deploy-api.sh` idempotent |
| SCA-B8-04 | `cd.yml` | Rollback : `workflow_dispatch` avec un SHA → redéploie cette image. Les 5 dernières images sont conservées |
| SCA-B8-05 | `cd.yml:118,165,208` | Fronts : rsync vers `releases/<sha>/` puis bascule d'un lien symbolique ; conserver les 3 dernières versions (plus de `ChunkLoadError`) |

### PHASE B9 — Validation par la charge

| ID | Quoi | Terminé quand |
|---|---|---|
| SCA-B9-01 | Lancer `tools/load/peak.js` contre **beta**, avec une base beta chargée d'un volume réaliste (script de seed de charge : 2 000 users × 2 000 trades, `isDemo: false`, dans la base **beta uniquement**) | Rapport : p50 / p95 / p99, taux d'erreur, pic mémoire par conteneur, CPU, connexions PgBouncer, mémoire Redis, à 200 / 500 / 1 000 / 1 500 VU |
| SCA-B9-02 | `signup-wave.js` : 30 inscriptions/min pendant 10 min | 0 OOM, 0 e-mail perdu |
| SCA-B9-03 | Relancer après chaque phase B1–B6 et comparer | Tableau avant / après dans le rapport |

**Critère de sortie de la partie B :** 1 500 VU tenus 15 min sur beta, p95 < 300 ms,
0 % de 5xx, aucun redémarrage de conteneur, sur un VPS de la taille de la prod.
Si ce n'est pas atteint : le rapport indique **quelle ressource sature en premier**
(CPU API, CPU Postgres, RAM, connexions). C'est ce qui décide de la partie C.

---

# PARTIE C — Ce qui coûte (à proposer, **ne rien acheter**)

> Les prix sont des **ordres de grandeur HT à vérifier** sur le site de chaque fournisseur le
> jour de la décision. L'agent présente ce tableau dans son rapport final, trié par
> **rapport gain / coût**, en indiquant ce que la phase B9 a mesuré pour justifier chaque ligne.

| Priorité | Poste | Pourquoi | Ordre de grandeur | Déclencheur |
|---|---|---|---|---|
| 1 | **Plan Resend payant** (ex. Pro : 50 k e-mails/mois) | Sans lui, plafond d'environ 50 inscriptions/jour en offre gratuite | ~20 $/mois | Dès le référencement si A-06a = gratuit |
| 2 | **Second petit VPS pour dev et beta** | Sort 1,2 Go de RAM et la concurrence CPU/DB de la prod ; supprime le risque de mélange Redis/Postgres | ~5–10 €/mois | Avant 2 000 actifs |
| 3 | **VPS prod plus gros** (8 vCPU / 16–24 Go) | Marge pour 1 500 connectés simultanés avec Postgres sur la même machine | ~15–30 €/mois (écart avec l'actuel) | Si B9 sature le CPU ou la RAM sur 4 vCPU |
| 4 | **Stockage objet pour les sauvegardes** au-delà du gratuit | Sauvegardes hors-site avec historique long | quelques €/mois | Si la base dépasse ~10 Go compressés |
| 5 | **Snapshots / backup automatique OVH** du VPS | Restauration de la machine entière en minutes | ~2–5 €/mois | Avant le référencement (recommandé) |
| 6 | **Sentry Team** | Au-delà du quota gratuit d'erreurs | ~26 $/mois | Si le quota gratuit est dépassé |
| 7 | **Monitoring payant** (Better Stack, Grafana Cloud Pro) | Alertes SMS/appel, rétention des métriques | 0–30 €/mois | Quand un astreinte est nécessaire |
| 8 | **Postgres managé** (OVH Public Cloud Databases ou autre) | Sauvegardes PITR, haute disponibilité, montée en taille sans migration manuelle | ~30–80 €/mois | Au-delà de 10 000 actifs, ou si la perte d'une journée de données devient inacceptable |
| 9 | **Deuxième VPS API + équilibrage** | Haute disponibilité (une machine qui tombe ne coupe plus le service) | ~15–30 €/mois + LB éventuel | Quand le chiffre d'affaires justifie un SLA |
| 10 | **Tier Anthropic supérieur / budget IA** | Débrief et récaps Premium à grande échelle | variable (proportionnel aux Premium) | Si B9 ou la prod montre des 429 IA |
| 11 | **Plan données de marché supérieur** | Prix en direct pour 1 500 connectés | variable | Si A-06d montre un quota trop bas |
| 12 | **Accord partenaire Tradovate** | Quotas WebSocket / API adaptés à des milliers d'utilisateurs | à négocier | Si A-06c montre une limite par application ou par IP |

**À ne pas acheter** (les correctifs gratuits suffisent jusqu'à 10 000 actifs) : Kubernetes,
un CDN payant pour l'API, un Redis managé, un « auto-scaling » cloud. Un CDN **gratuit**
(Cloudflare) devant les fronts statiques est possible, mais pas devant l'API sans adapter
`trust proxy` et le rate limiting aux IP Cloudflare : ne pas le faire sans décision explicite.

---

## 5. Commandes de vérification

```sh
pnpm install --frozen-lockfile
pnpm exec prisma generate --config=./prisma/prisma.config.ts
pnpm nx lint  api-mytradingcoach && pnpm nx test api-mytradingcoach
pnpm nx lint  app-mytradingcoach && pnpm nx test app-mytradingcoach
pnpm nx build api-mytradingcoach -c production
pnpm nx build app-mytradingcoach -c production
# Tests d'intégration API (Postgres + Redis locaux : docker compose up -d postgres redis)
(cd apps/api-mytradingcoach && env $(grep -vE '^#|^$' ../../.env | xargs -d '\n') \
  ../../node_modules/.bin/vitest run --config $PWD/vitest.integration.config.mts)   # voir tests.md
# Plus aucun KEYS Redis
grep -rn "\.keys(" apps/api-mytradingcoach/src --include=*.ts | grep -v spec
# Plus aucun Promise.all sur une liste d'utilisateurs dans les crons
grep -rn "Promise.all" apps/api-mytradingcoach/src --include=*.cron.ts
```

## 6. Ordre de livraison recommandé

1. **Partie A** (agent via SSH en lecture + questions à l'humain pour A-06) : A-01 et A-06a sont bloquants pour le jour J.
2. **B0** : une PR, avant le référencement.
3. **B7-06, B7-08, B7-09** (humain + agent) : avant le référencement.
4. **B1 → B3** : première semaine.
5. **B4 → B6** : deuxième semaine.
6. **B8, B9** : en continu. B9 est relancé après chaque phase.
7. **Partie C** : décision après le premier passage de B9.

## 7. Décisions à faire valider AVANT de commencer

| ID | Question | Choix par défaut |
|---|---|---|
| D1 | Nombre de workers web par défaut | 3 sur 4 vCPU (le 4ᵉ cœur pour Postgres et le worker) |
| D2 | L'e-mail admin par inscription est supprimé (remplacé par un digest quotidien) | Oui |
| D3 | Equity curve « par trade » : échantillonnée au-delà de 2 000 points | Oui (invisible à l'œil) |
| D4 | Blue/green (B8-03) ou simple redémarrage gardé par healthcheck | Blue/green |
| D5 | dev et beta éteints hors tests tant qu'il n'y a pas de second VPS | Oui |
| D6 | `/eco` exige une connexion (la landing ne s'y connecte pas) | Oui, après vérification qu'aucune page publique ne l'utilise |

## 8. Rapport à produire à la fin de chaque phase

```markdown
## Phase <id> — <titre>
- Branche / PR : …
- Tâches faites : ID — résumé (commit sha)
- Tâches non faites, modifiées ou bloquées (⛔ contrôle A-xx sans réponse) : ID — raison
- Constats de l'audit faux ou déjà corrigés : …
- Vérifications : lint ✅/❌ · tests ✅/❌ (nb) · build ✅/❌ · tests d'équivalence ✅/❌
- Mesure de charge (si B9 relancé) : VU max tenus, p95, erreurs, ressource saturée en premier
- Actions faites sur le VPS (commande, validation reçue, vérification, retour arrière) : …
- Nouvelles variables d'environnement : nom — défaut — valeur conseillée prod
- Agents `.claude/agents/*` mis à jour : …
```

## 9. Définition de « terminé »

- [ ] Partie A : `docs/ops/controle-vps-<date>.md` committé, aucun secret dedans, aucune écriture faite sur le VPS pendant les contrôles.
- [ ] Prod, dev et beta isolés dans Redis ; plus aucun `KEYS` ; plus aucun `Promise.all` non borné sur des users.
- [ ] Conteneur API : workers bornés, plafond de tas, argon2 OWASP, Chromium réutilisé et borné.
- [ ] Inscriptions limitées par IP ; e-mails en file avec limiteur et retry.
- [ ] Agrégats analytics, journal et comptes en SQL, avec tests d'équivalence verts.
- [ ] Import par lots ; regrade asynchrone ; parsing hors event loop.
- [ ] Crons et files dans un conteneur `worker` séparé ; verrous anti-chevauchement.
- [ ] Moins de 3 requêtes/min par onglet en session (hors quick-trade), zéro onglet caché qui poll.
- [ ] Déploiement sans coupure avec rollback ; sauvegarde hors-site testée ; supervision active.
- [ ] B9 : 1 500 VU pendant 15 min sur beta, p95 < 300 ms, 0 % de 5xx, 0 redémarrage.
- [ ] Partie C présentée, chiffrée et justifiée par les mesures de B9.
- [ ] `deploy.md`, `nestjs.md`, `prisma.md`, `security.md`, `angular.md` à jour.
