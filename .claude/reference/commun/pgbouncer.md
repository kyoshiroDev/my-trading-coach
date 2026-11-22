# Postgres et PgBouncer

> Contenu déplacé à l'identique depuis `.claude/agents/deploy.md`, `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : deploy.md · Pool Postgres et PgBouncer (SCA-B0-05, 2026-09-30) · 2026-09-30 -->
> **Origine** : `deploy.md` · « Pool Postgres et PgBouncer (SCA-B0-05, 2026-09-30) » · 2026-09-30

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

<!-- Origine : deploy.md · Postgres et PgBouncer (SCA-B7-02, 2026-10-01) · 2026-10-01 -->
> **Origine** : `deploy.md` · « Postgres et PgBouncer (SCA-B7-02, 2026-10-01) » · 2026-10-01

## Postgres et PgBouncer (SCA-B7-02, 2026-10-01)

Compose : `/opt/infra/databases/docker-compose.yml` (non versionné, sauvegardé chaque nuit sur B2).

**PgBouncer — piège de l'image `pgbouncer/pgbouncer`** : elle ne lit **que** les variables
`PGBOUNCER_*` et `DATABASES` (voir `/opt/pgbouncer/entrypoint.sh` dans le conteneur). Jusqu'au
2026-10-01, le compose passait `POOL_MODE`, `DEFAULT_POOL_SIZE`, `MAX_CLIENT_CONN`, `AUTH_TYPE` :
**toutes ignorées** (tournait en `session`, 20/base, 100 clients). Toujours contrôler la config
**effective**, jamais le compose :
```sh
# mot de passe = celui de mtc_user (DATABASES_PASSWORD du compose)
docker exec -it mtc_postgres psql -h mtc_pgbouncer -p 6432 -U mtc_user -d pgbouncer -c 'SHOW CONFIG'   # ou SHOW DATABASES / SHOW POOLS
```
Réglages actuels :
| | Valeur | Pourquoi |
|---|---|---|
| `pool_mode` | **session** (constaté le 2026-11-21, #1110 : `/etc/pgbouncer/pgbouncer.ini` du conteneur prod, généré à son démarrage du 07/11) | l'API plafonne déjà ses connexions (3 workers × `DB_POOL_MAX`) ; passer en `transaction` = changement de comportement non testé |
| pool par base (`DATABASES`) | prod **25** (VPS prod, constaté le 21/11) ; dev **6**, beta **6** (ancien VPS, relevé du 01/10) | un Postgres par VPS : prod plafonnée par `max_db_connections` (40, ligne ci-dessous) ; ancien VPS : dev + beta = 12 |
| `max_client_conn` | 200 | |
| `default_pool_size` / `max_db_connections` (VPS prod) | 5 / 40 (constaté le 21/11) | `max_db_connections` plafonne le total des connexions serveur |
| `query_wait_timeout` | 30 s (au lieu de 120) | échouer vite plutôt que de faire attendre 2 min |
| `DB_POOL_MAX` API | prod 5 (défaut) · **dev et beta 2** (`.env.dev`, `.env.beta`) | 3 × 2 = 6 = pool de la base |

**Authentification** (corrigée le 2026-10-01 ; avant : `auth_type = any`, sans mot de passe) :
`PGBOUNCER_AUTH_TYPE=scram-sha-256`, `PGBOUNCER_AUTH_FILE=/etc/pgbouncer-auth/userlist.txt`
(dossier `/opt/infra/databases/pgbouncer-auth/`, monté en lecture seule, `600`, propriétaire
uid 70 = user `postgres` du conteneur). Il contient l'**empreinte SCRAM** de `mtc_user` copiée de
`pg_authid`, pas le mot de passe. Console admin : `mtc_user` uniquement (plus `postgres`).
⚠️ **Si le mot de passe de `mtc_user` change, régénérer le fichier** sinon toutes les API perdent la
base :
```sh
D=/opt/infra/databases/pgbouncer-auth
s=$(docker exec mtc_postgres psql -U mtc_user -d postgres -Atc "select rolpassword from pg_authid where rolname='mtc_user'")
(umask 077; printf '"mtc_user" "%s"\n' "$s" > $D/userlist.txt); unset s
docker run --rm -v $D:/d alpine:3 sh -c 'chown 70:70 /d/userlist.txt && chmod 600 /d/userlist.txt'
docker exec -it mtc_postgres psql -h mtc_pgbouncer -p 6432 -U mtc_user -d pgbouncer -c 'RELOAD'
```
Le dossier est inclus dans la sauvegarde B2 (`/infra/databases`).

**Postgres** : `max_connections` **reste à 50** (pas 100) : `shared_buffers` = 1 920 Mo sur une
limite conteneur de 2,5 Go, il ne reste ~640 Mo pour les connexions ; au-delà, risque d'OOM de
Postgres. Ajouts :
- `pg_stat_statements` : sur le **VPS prod** (149.202.40.240), l'extension est dans la base
  **`mytradingcoach_prod`** (créée par `infra/prod/databases/init-db.sh`), **pas** dans `postgres` :
  y lancer une requête depuis `postgres` répond « relation pg_stat_statements does not exist ». La vue
  couvre quand même toutes les bases. Top requêtes (lecture seule) :
  `docker exec mtc_postgres psql -U mtc_readonly -d mytradingcoach_prod -c "select d.datname, calls, round(mean_exec_time) ms, left(query,80) from pg_stat_statements s join pg_database d on d.oid=s.dbid order by total_exec_time desc limit 15"`
  ⚠️ `pg_stat_statements.track_utility = on` : une commande utilitaire y est gardée en texte. Tout
  `ALTER ROLE … PASSWORD` se fait dans une session avec `SET pg_stat_statements.track_utility = off`
  (et `log_min_error_statement = panic`, `log_min_duration_statement = -1`), comme dans
  `infra/ops/rotation-mot-de-passe/`.
- `log_min_duration_statement=500` : requêtes > 500 ms dans `docker logs mtc_postgres`, **sans les
  valeurs des paramètres** (`log_parameter_max_length=0`, pas d'e-mail dans les logs).
- Changer `command:` = redémarrage de Postgres ≈ **10 s de 503** sur l'API prod (mesuré) : hors
  heures du marché US. L'API se reconnecte seule, pas besoin de la redémarrer.
- VPS remonté de zéro (`docs/ops/reprise-vps.md`) : refaire `CREATE EXTENSION pg_stat_statements`
  dans la base `mytradingcoach_prod` (fait par `init-db.sh` au premier démarrage).

<!-- Origine : security.md · PgBouncer : authentification SCRAM obligatoire (SCA-B7-02, 2026-10-01) · 2026-10-01 -->
> **Origine** : `security.md` · « PgBouncer : authentification SCRAM obligatoire (SCA-B7-02, 2026-10-01) » · 2026-10-01

## PgBouncer : authentification SCRAM obligatoire (SCA-B7-02, 2026-10-01)

Jusqu'au 2026-10-01, `auth_type = any` (défaut de l'image `pgbouncer/pgbouncer`) : tout conteneur
du réseau `mtc_network` (dont Traefik, exposé à Internet) ouvrait une session sur les 3 bases sans
mot de passe. Désormais `scram-sha-256` avec un `userlist.txt` (empreinte SCRAM, pas le mot de
passe) ; sans mot de passe ou avec un mauvais → refus, vérifié. Console admin réservée à
`mtc_user`. Procédure de régénération si le mot de passe change : `deploy.md`.
Leçon : une image configurée par variables d'environnement peut **ignorer en silence** des
variables mal nommées — contrôler la config effective (`SHOW CONFIG`), jamais le compose.
