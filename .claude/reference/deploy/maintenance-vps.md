# Maintenance des VPS

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Maintenance des VPS (2026-10-16) · 2026-10-16 -->
> **Origine** : `deploy.md` · « Maintenance des VPS (2026-10-16) » · 2026-10-16

## Maintenance des VPS (2026-10-16)

| | Ancien VPS `51.83.197.230` (dev, beta, landing, admin) | VPS prod `149.202.40.240` |
|---|---|---|
| MAJ sécurité | unattended-upgrades | unattended-upgrades (Docker en liste noire) |
| Reboot | **auto à 05:00** si requis (`52unattended-upgrades-local`) | **jamais auto** (`52mtc-unattended`) → alerte e-mail `watch-containers.sh`, reboot planifié à la main |
| sudo | mot de passe → Greg lance les commandes dans SON terminal | mot de passe (NOPASSWD de la migration retiré le 2026-10-17) |

Procédure : audit en lecture seule (`uptime`, `/var/run/reboot-required.pkgs`, `apt list --upgradable`,
`docker system df`, volumes sans conteneur, mtime des logs cron) → nettoyage → `apt-get full-upgrade`
(la MAJ de `docker-ce`/`containerd` redémarre tous les conteneurs ≈ 1 min, ils remontent grâce à
`unless-stopped`) → reboot → vérifier `uptime`, noyau, `docker ps`, `WATCH_DRY=1 watch-containers.sh`,
les URL publiques. Commandes sudo données à Greg : **courtes et sans guillemets imbriqués** (déposer
les fichiers dans `~` d'abord) ; une longue chaîne collée a été tronquée et le reboot n'est jamais parti.

### VPS prod partagé avec un autre projet hébergé (2026-11-25)

Le VPS prod (6 vCPU) héberge aussi un autre projet, indépendant de MTC (son dépôt, ses bases, réseaux
et sauvegardes). Il ne partage que Traefik.

- **En-têtes de sécurité au routeur** : l'entrypoint `websecure` ne porte plus de middleware (il est
  partagé). Chaque routeur MTC déclare `traefik.http.routers.<nom>.middlewares=security-headers@file`
  (`api-prod-secure` dans `docker-compose.prod.yml`, `app-prod` dans `infra/prod/static-docker-compose.yml`) ;
  les valeurs restent dans `infra/prod/traefik/conf.d/security.yml`. **Tout nouveau routeur le déclare.**
  Ne jamais remettre de middleware sur l'entrypoint.
- Le routeur de l'API s'appelle `api-prod-secure` (service `api-prod` inchangé) : pendant la bascule
  blue/green qui l'a introduit, l'ancienne couleur gardait `api-prod` sans middleware et la nouvelle
  `api-prod-secure` avec, deux routeurs distincts, sans conflit de définition.
- **Ne jamais toucher** au résolveur ACME secondaire de `traefik.yml` ni au `docker-compose.override.yml`
  (réseaux) de `/opt/infra/traefik/` sur le serveur : ils sont à l'autre projet, et ne sont pas recopiés
  dans `infra/prod/traefik/`.
- **Limites mémoire** (pics mesurés le 2026-11-24) : API web 1536 Mio par couleur, `WEB_CONCURRENCY=2`
  (pic 766 Mio à 3 workers sans charge) ; worker 768 Mio (pic 350 Mio) ; Postgres 1024 Mio (#1286),
  `shared_buffers=384MB`, `effective_cache_size=1GB`, `maintenance_work_mem=128MB` (base 55 Mo, pic
  251 Mio) ; Redis 320 Mio, `maxmemory 256mb` (3 Mo de données) ; Traefik 384 Mio (pic 208 Mio) ;
  socket-proxy 64 Mio ; bot Discord 128 Mio ; nginx de l'app 64 Mio ; builder BuildKit `mtc-build`
  1536 Mio ; restic 512 Mio (`offsite.sh`). Pendant la bascule blue/green, deux couleurs tournent
  ~1 min (2 × 1,5 Gio).
- **4 Gio garantis à l'autre projet hébergé** (#1286), garantie stricte sur les plafonds : RAM
  11 671 Mio − hôte hors conteneurs (H) − 4 096 − pire cas MTC ≥ 256 Mio de marge. Pire cas MTC en
  plafonds : ~5 888 Mio, que ce soit en régime normal + build, pendant la bascule ou la nuit (restic).
  Verrou `/tmp/mtc-memoire.lock` (`flock`) partagé par `deploy-api.sh` (tout le déploiement),
  `build-image.sh`, `offsite.sh` (sauvegarde et restauration), `restore-test.sh` (Postgres jetable,
  512 Mio) et les prunes de `mtc-build` (CD,
  crontab) : jamais de build, migration, bascule ni prune pendant restic (sinon
  4 352 + 1 536 + 512 = 6 400). Toute hausse d'un plafond MTC se recalcule avec cette formule avant d'être appliquée. `gzip` du dump
  de 3 h n'est pas plafonné : quelques Mio.
- **Plus de build sur les VPS en CD/CI** (#1290, 2026-11-26) : images API (prod et dev) et bot construites
  sur le runner GitHub (`cd.yml`, `ci.yml`), envoyées par `infra/ci/ship-image.sh` (`docker save` → zstd →
  SSH, clé d'hôte épinglée → `docker load` sous le verrou mémoire), `DEPLOY_REQUIRE_IMAGE=1` : image absente
  → déploiement en échec avant la migration, jamais de repli sur un build. Le builder `mtc-build` ne sert plus
  qu'au déploiement manuel (`deploy-api-manual.yml`, SHA sans image gardée) et à la reprise à la main ; son
  cache n'est plus prune en CD, seulement le dimanche (crontab).
  Prérequis : `zstd` sur les deux VPS (`/usr/bin/zstd`, constaté le 2026-11-26) ; absent → l'étape
  « Envoyer l'image » échoue, rien n'est basculé. Mémoire du `docker load` (dockerd, non plafonné, sous le
  verrou) : rechargement de l'image API prod (712 Mo en zstd) le 2026-11-26, 9 s, `MemAvailable` −100 Mio
  au plus, dockerd stable à 742 Mio, `oom_kill` 0 (couches déjà présentes : à recontrôler à la première CD
  avec `oom_kill` du service docker).
- **Builds plafonnés** (#1286, secours depuis #1290) : l'image API (`deploy-api.sh`) et le bot se construisent par
  `infra/build-image.sh`, dans le builder `mtc-build` (pilote `docker-container`, 1536 Mio,
  `max-parallelism = 1`, `infra/buildkitd.toml`), créé au premier build et **arrêté après chaque build et
  chaque prune** (`docker buildx stop`, cache gardé) : ses 1536 Mio ne s'ajoutent jamais à la bascule.
  Plafond et `buildkitd.toml` ne sont lus qu'à la création du builder : pour les changer,
  `docker buildx rm mtc-build` (recréé au build suivant). Image épinglée `moby/buildkit:v0.35.1`
  (`build-image.sh`, et son miroir dans `build-memory.yml`) : changer de version = modifier les deux,
  puis `docker buildx rm mtc-build`.
  Nécessite buildx ≥ 0.13 (`--buildkitd-config`). En CI : miroir `mirror.gcr.io` (`buildkitd.ci.toml`).
  Le garde-fou vaut aussi sur l'ancien VPS (déploiement dev de `ci.yml`, qui passe par `deploy-api.sh`) :
  il y faut 1 792 Mio disponibles, sinon le déploiement dev échoue avant la migration (dev inchangé). Garde-fou : pas de build si
  `MemAvailable` < 1536 + 256 Mio (échec avant migration, la version en service continue). Dans
  l'image, `NODE_OPTIONS=--max-old-space-size=1024` (étages builder et migrator). Le pic à froid est
  mesuré à chaque PR qui touche l'API ou le bot (workflow `build-memory.yml`, `infra/ci/build-memory-measure.sh`).
  Indicateur : pic de `anon` + `kernel` + `shmem` (mémoire non récupérable), `oom_kill` = 0. `memory.peak` compte le
  cache de pages et touche le plafond sans risque. Prune : `docker buildx
  prune --builder mtc-build` (CD et crontab), précédé de `docker buildx inspect --bootstrap mtc-build` : le builder
  est arrêté et `prune` ne le démarre pas (« driver not running », CD dev du 2026-11-25). Builder absent
  (après `docker buildx rm`) : prune sauté, une ligne au journal. **Ne jamais construire une image hors de ce builder sur le
  VPS prod** (sauf reprise à la main, `docs/ops/reprise-vps.md`) sans vérifier la RAM libre (`free -m`).
- Recréer `mtc_postgres` (changement de réglages ou de limites) : PgBouncer doit être relancé, sinon il
  garde l'ancienne IP de Postgres et l'API reste en 503 (~75 s le 2026-11-25). Toujours enchaîner
  `docker compose up -d && docker restart mtc_pgbouncer`, puis vérifier `/api/health/ready`. Le
  `depends_on` `restart: true` de #1278 n'est qu'un filet (projet entier sans nom de service seulement) ;
  détail dans `reference/commun/pgbouncer.md`.
- Ordre de mise en place : PR fusionnée sur `main` et CD verte (routeurs avec middleware) **avant** que
  Greg retire le middleware de l'entrypoint sur le serveur (static, databases, puis traefik). Revenir sur
  les routeurs n'est sûr que tant que le middleware est encore sur l'entrypoint.

### Durcissement des entrypoints Traefik prod (#1282)

- `infra/prod/traefik/traefik.yml` pose sur les entrypoints `web` et `websecure` :
  `aliasHeadersStrategy: delete` (en-têtes de requête dont le nom contient autre chose que lettres,
  chiffres, tirets : supprimés) et les 7 `encodedCharacters.allowEncoded*: false` (`%2F %5C %00 %3B
  %25 %3F %23` dans le **chemin** → 400 ; la query n'est pas contrôlée). `ping` : `aliasHeadersStrategy`
  seulement. Doc : Traefik v3.7, `security/header-aliases.md` et `security/request-path.md`.
- Ce ne sont pas des middlewares (règle 12 de `deploy.md` inchangée), mais ces options n'existent
  **que sur l'entrypoint** : elles valent aussi pour l'autre projet hébergé.
- MTC n'en dépend pas (inventaire #1282) : aucun en-tête avec `_` ou `.`, aucune route avec un
  caractère encodé dans le chemin (paramètres cuid, slugs, dates ; tokens des e-mails en hex et en query).
  Un nouvel en-tête personnalisé MTC s'écrit en lettres, chiffres et tirets ; une valeur libre va en
  query ou dans le corps, jamais dans le chemin.
- Application sur le serveur, avec l'accord explicite de Greg : commandes données une par une, Greg
  les tape (sauf autorisation écrite pour la tâche), jamais de `sudo` par Claude. Sauvegarde datée à la
  minute (`traefik.yml.bak-AAAAMMJJ-HHMM`, `cp -p --update=none` puis `cmp`), diff limité à ces blocs (le
  résolveur secondaire de l'autre projet ne bouge pas), puis **recréation** de Traefik depuis
  `/opt/infra/traefik/` (`docker compose up -d --force-recreate traefik`, avec le
  `docker-compose.override.yml` du serveur s'il existe ; pas de `docker restart` : `traefik.yml` est
  monté comme un fichier seul, un fichier réécrit peut ne pas être vu). Quelques secondes de coupure.
  Vérifier : plus de `WRN` sur ces options dans `docker logs mtc_traefik`, `/api/health` en 200,
  `curl -s -o /dev/null -w '%{http_code}' https://api.mytradingcoach.app/api/a%2Fb` en 400, l'app en 200.
  Test local du 2026-11-25 (traefik v3.7.19 jetable) : config acceptée, plus aucun WRN, les 7 caractères
  en 400 dans le chemin (la query passe), `X_Test`, `X.Auth.User`, `Foo_Bar` retirés, `X-Ok` gardé,
  redirection `web` → `websecure` intacte ; un chemin encodé sur `web` répond 400 avant la redirection.
  Le journal d'accès donne le routeur pour ces 400 (hôte inconnu : 404) ; les requêtes sur `web` n'y
  apparaissent pas.
- **Contrôle à J+1** (lecture seule, lancé par Greg) : le refus a lieu après le routage : le journal
  d'accès donne le routeur (champ 8 entre guillemets), le backend vaut `-`. Grouper par routeur ; ceux
  hors MTC (autres que `api-prod-secure`, `app-prod`) sont à l'autre projet. Filtrer sur le chemin seul
  (une 400 applicative sur une query encodée ne compte pas) :
  `docker logs --since 24h mtc_traefik 2>&1 | grep -iE '^[^"]*"[A-Z]+ [^ ?]*%(2f|5c|00|3b|25|3f|23)[^ ]* [^"]*" 400 ' | awk -F'"' '{print $8, $2}' | sort | uniq -c | sort -rn | head -30`
- **Retour arrière ciblé** si l'autre projet est gêné : retirer seulement le bloc `encodedCharacters`
  de `web` et `websecure` (retour aux valeurs par défaut) et recréer Traefik ; garder
  `aliasHeadersStrategy: delete`. **Retour complet** : remettre la sauvegarde datée de `traefik.yml`,
  puis recréer `mtc_traefik` de la même façon (jamais `docker restart`).

### Mettre à jour une image (nginx, Traefik…) — appliqué le 2026-11-22 (faille nginx2root)

Versions : les fichiers compose font foi, ne pas les recopier ici. **Prod épinglée** (tag précis dans
`infra/prod/…`, identique à `/opt/infra/<stack>/` sur le serveur) ; **ancien VPS en tags flottants**
(`nginx:alpine`, `traefik:v2.11`, compose hors dépôt dans `/opt/infra/static/` et `/opt/infra/traefik/`).

- Prod : `docker pull <image:tag>` (vérifier la version avec `docker run --rm <image> … version`) →
  copie datée à la minute du compose (`cp -p docker-compose.yml docker-compose.yml.bak-AAAAMMJJ-HHMM`)
  → changer le tag → `docker compose up -d` dans `/opt/infra/<stack>` → reporter le tag dans `infra/prod/…` (PR).
- Ancien VPS : `docker pull nginx:alpine` / `traefik:v2.11` → `docker compose up -d` dans `/opt/infra/static`
  (**les 2 fichiers** : `docker-compose.yml` et `docker-compose.beta.yml`) puis dans `/opt/infra/traefik`.
- Vérifier : version dans chaque conteneur (`docker exec <c> nginx -v`, `traefik version`), routes publiques en h2
  (www 302 → /prop-firm, vrai 404, admin, dev, beta, dev.api, app, `api/health`), logs Traefik sans erreur,
  date de fin du certificat (`openssl s_client … | openssl x509 -noout -enddate`).
- Aucun nginx ne publie de port : seul Traefik reçoit le trafic public (HTTP/2 terminé par Traefik).

### Mineures Postgres et Redis (#1202, 2026-11-27)

Postgres sort ses mineures en février, mai, août et novembre ; Redis à chaque correctif. Docker-socket-proxy :
`v0.5.0` reste la dernière (relevé du 2026-11-27). Le tag se change dans `infra/prod/databases/docker-compose.yml`,
`infra/prod/load/docker-compose.load.yml` et `infra/prod/backups/restore-test.sh` (Postgres jetable du test de
restauration), puis sur le serveur.

- **Notes de version d'abord** : une mineure Postgres ne demande ni dump ni `pg_upgrade`, mais peut demander un
  `REINDEX` ciblé. 17.12 (2026-11-12) : index btree sur `bpchar`, GIN, `gist_trgm_ops`, index TOAST après un
  `REINDEX CONCURRENTLY`. MTC n'en a aucun (schéma Prisma : ni `@db.Char`, ni GIN, ni `pg_trgm` ; seule extension
  `pg_stat_statements`) : rien à réindexer. À revérifier à chaque mineure.

Commandes données à Greg, une par une, sur les deux VPS (jamais lancées par Claude) ; accord explicite pour la prod.

- **Ancien VPS d'abord (dev et beta, un seul Postgres ; tags flottants `17-alpine`, `7.4-alpine`)** :
  1. dump manuel de dev et de beta juste avant (même commande que `backup.sh`),
     `mtc_<env>_AAAAMMJJTHHMM_avant-mineure.sql.gz` dans `/opt/backups/mtc/`, vérifié par `gzip -t` et sa taille ;
  2. relever les versions en place (Greg note la sortie, elle sert au retour arrière) :
     `docker exec mtc_postgres postgres --version`, `docker exec mtc_redis redis-server --version`,
     `docker exec mtc_redis_beta redis-server --version` ;
  3. `docker pull postgres:17-alpine` et `docker pull redis:7.4-alpine` ;
  4. dans `/opt/infra/databases`, **les 2 fichiers** : `docker compose up -d && docker restart mtc_pgbouncer`, puis
     `docker compose -f docker-compose.beta.yml up -d` (`mtc_redis_beta`) ;
  5. vérifier `docker exec mtc_postgres postgres --version`, `docker exec mtc_redis redis-server --version`,
     `docker exec mtc_redis_beta redis-server --version`, `dev.api.mytradingcoach.app/api/health/ready` et la beta.
  Les conteneurs d'un autre projet sur ce VPS ne bougent pas.
- **Prod (créneau calme)** :
  1. dump manuel juste avant (commande de « Avant un reboot de la prod »), `mtc_prod_AAAAMMJJTHHMM_avant-mineure.sql.gz` ;
  2. `docker pull` des deux tags ;
  3. dans `/opt/infra/databases/` : `B=docker-compose.yml.bak-$(date +%Y%m%d-%H%M); cp -pn docker-compose.yml "$B" && cmp docker-compose.yml "$B"`,
     tags changés,
     `docker compose up -d && docker restart mtc_pgbouncer` (Postgres recréé : PgBouncer garde sinon l'ancienne IP,
     voir plus haut). Coupure de quelques secondes ; Redis recréé recharge son AOF (jobs BullMQ gardés) ;
  4. vérifier `docker exec mtc_postgres postgres --version`, `docker exec mtc_redis redis-server --version`,
     `/api/health/ready`, `docker logs mtc_pgbouncer --tail=5` ;
  5. recopier `restore-test.sh` dans `/opt/backups/` du serveur.
- **Retour arrière** : une mineure se rétrograde sans dump (même format de données). Prod : remettre la copie
  `.bak` du compose, puis `docker compose up -d && docker restart mtc_pgbouncer`. Ancien VPS (tags flottants) :
  la `.bak` ne suffit pas, écrire à la main le tag précis relevé à l'étape 2 puis les mêmes commandes.

### Avant un reboot de la prod

- **Dump manuel juste avant** (la sauvegarde auto date de 03:00) : même commande que `backup.sh`, fichier
  `mtc_prod_AAAAMMJJTHHMM_avant-reboot.sql.gz` dans `/opt/backups/mtc/`, vérifié par `gzip -t` et sa taille.
- Tous les conteneurs sont en `unless-stopped` : **ne pas les `docker stop` à la main** avant le reboot (ils ne
  remonteraient pas). Postgres s'arrête avec `SIGINT` (arrêt rapide de l'image) dans les 10 s accordées par Docker.
- Créneau calme (week-end, marchés fermés) : le reboot coupe l'API 1 à 2 min (blue/green ne protège pas d'un reboot de l'hôte).
- Après : `uptime` et noyau, `docker ps` (blue ou green actif, worker), `/api/health` puis `/api/health/ready`,
  `docker logs mtc_pgbouncer --tail=5`, `WATCH_DRY=1 /opt/backups/watch-containers.sh`.

Ancien VPS : `live-restore=false`, la MAJ de `docker-ce` coupe ≈ 1 min **aussi la landing www. et l'admin**.
Il redémarre seul à 05:00 si un reboot est requis : préférer le reboot manuel tout de suite, puis vérifier.

Ancienne prod retirée de l'ancien VPS le 2026-10-16 (images, `/opt/apps/mytradingcoach/prod`,
`/opt/static/app-prod`, service `app-prod` du compose static, prod de `backup.sh`/`backup-apps.sh`).
Base `mytradingcoach_prod` supprimée de son Postgres le même jour (dump final
`/opt/backups/mtc/mtc_prod_20261016_final.sql.gz`, `.env` dans `/opt/backups/ancienne-prod/`) ;
son `restore-test.sh` vérifie désormais la beta. Reste l'entrée `mytradingcoach_prod` dans `DATABASES`
de PgBouncer (sans effet, à retirer à la prochaine recréation de PgBouncer).
