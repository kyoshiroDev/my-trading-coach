#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
# Migrations via connexion directe (PgBouncer en transaction mode ne supporte pas les migrations DDL)
DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" \
  ./node_modules/.bin/prisma migrate deploy --config=./prisma/prisma.config.ts
echo "[entrypoint] Migrations complete. Starting NestJS..."
exec node main.js