#!/bin/sh
set -e

# Migrations via connexion directe (PgBouncer ne supporte pas les migrations DDL).
migrate() {
  echo "[entrypoint] Running Prisma migrations..."
  DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" \
    ./node_modules/.bin/prisma migrate deploy --config=./prisma/prisma.config.ts
  echo "[entrypoint] Migrations complete."
}

# Déploiement sans coupure (SCA-B8-02) : le script de bascule lance la migration UNE fois, avant de
# démarrer la nouvelle couleur (`docker compose run --rm <service> migrate`), puis démarre les
# conteneurs avec RUN_MIGRATIONS=false. Sans la variable : migration au démarrage, comme avant.
if [ "$1" = "migrate" ]; then
  migrate
  exit 0
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  migrate
else
  echo "[entrypoint] RUN_MIGRATIONS=${RUN_MIGRATIONS} : migrations laissées au script de déploiement."
fi
echo "[entrypoint] Starting NestJS..."
exec node main.js
