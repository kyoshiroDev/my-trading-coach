#!/usr/bin/env bash
# Bascule VPS prod — à lancer SUR L'ANCIEN VPS (via `ssh … 'bash -s' < ce fichier`) : écrit sur la
# sortie standard un instantané RDB complet du Redis partagé (base 0 = prod, base 1 = dev).
# import-redis.sh ne garde que la base 0. Le mot de passe est lu dans la config du conteneur.
set -euo pipefail
P=$(docker inspect -f '{{json .Args}}' mtc_redis | tr -d '[]"' | tr ',' '\n' | grep -A1 -- '--requirepass' | tail -1)
docker exec -e REDISCLI_AUTH="$P" mtc_redis redis-cli --no-auth-warning --rdb /tmp/bascule.rdb >&2
docker exec mtc_redis cat /tmp/bascule.rdb
docker exec mtc_redis rm -f /tmp/bascule.rdb
