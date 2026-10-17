#!/usr/bin/env bash
# Bascule VPS prod — remplace le contenu du Redis prod par un instantané RDB de l'ancien VPS (lu sur
# l'entrée standard) et ne garde que la base 0 (prod) : files BullMQ en attente, verrous, caches.
#
#   ssh greg@51.83.197.230 'bash -s' < infra/prod/bascule/export-redis-ancien.sh \
#     | ssh greg@149.202.40.240 "bash /opt/infra/bascule/import-redis.sh"
#
# Piège Redis 7 : avec appendonly yes et aucun AOF, Redis démarre VIDE en ignorant dump.rdb. On démarre
# donc une fois sans AOF (charge le RDB), puis CONFIG SET appendonly yes réécrit l'AOF depuis la mémoire.
set -euo pipefail

cd /opt/infra/databases
VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' mtc_redis)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/dump.rdb"
[ "$(head -c 5 "$TMP/dump.rdb")" = REDIS ] || { echo "[import-redis] entrée qui n'est pas un RDB" >&2; exit 1; }
echo "[import-redis] $(date +%T) RDB reçu ($(du -h "$TMP/dump.rdb" | cut -f1)), volume ${VOL}"

docker compose stop redis >/dev/null
docker run --rm -v "$VOL":/data -v "$TMP":/in:ro alpine:3.22 \
  sh -c 'rm -rf /data/appendonlydir /data/dump.rdb && cp /in/dump.rdb /data/dump.rdb && chown 999:999 /data/dump.rdb'

# Démarrage sans AOF : Redis charge dump.rdb.
set -a; . ./.env; set +a
docker compose run -d --rm --no-deps --name mtc_redis_import -e REDISCLI_AUTH="$REDIS_PASSWORD" redis \
  redis-server --requirepass "$REDIS_PASSWORD" --appendonly no --maxmemory 512mb --maxmemory-policy noeviction >/dev/null
r() { docker exec mtc_redis_import redis-cli --no-auth-warning "$@"; }
for _ in $(seq 1 30); do [ "$(r ping 2>/dev/null)" = PONG ] && break; sleep 1; done
for db in $(seq 1 15); do r -n "$db" flushdb >/dev/null; done   # dev (1) et autres : pas en prod
r config set appendonly yes >/dev/null
for _ in $(seq 1 60); do
  r info persistence | grep -q '^aof_rewrite_in_progress:0' && r info persistence | grep -q '^aof_enabled:1' && break
  sleep 1
done
echo "[import-redis] $(date +%T) clés base 0 : $(r -n 0 dbsize)"
docker stop mtc_redis_import >/dev/null

docker compose up -d redis >/dev/null
for _ in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' mtc_redis)" = healthy ] && break; sleep 1; done
echo "[import-redis] $(date +%T) Redis prod : $(docker exec mtc_redis redis-cli --no-auth-warning info keyspace | grep '^db' | tr '\r\n' '  ')"
echo "[import-redis] $(date +%T) OK"
