#!/bin/bash
set -e

echo "🚀 Déploiement MyTradingCoach..."

# Pull dernière version
git pull origin main

# Build Angular (output → dist/apps/app-mytradingcoach/browser/)
echo "📦 Build Angular..."
NX_IGNORE_UNSUPPORTED_TS_SETUP=true npx nx build app-mytradingcoach --configuration=production

# Build image Docker NestJS
echo "🐳 Build Docker API..."
docker compose build api

# Redémarrage sans downtime
echo "♻️  Redémarrage..."
docker compose up -d --no-deps api
docker compose restart nginx

echo "✅ Déploiement terminé !"
docker compose ps