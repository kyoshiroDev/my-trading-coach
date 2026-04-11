#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
./node_modules/.bin/prisma migrate deploy
echo "[entrypoint] Migrations complete. Starting NestJS..."
exec node main.js
