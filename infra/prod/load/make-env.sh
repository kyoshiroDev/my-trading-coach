#!/usr/bin/env bash
# Génère les secrets de l'environnement de test de charge (docker-compose.load.yml), dans le dossier
# courant : .env (interpolation compose), .env.api (API de test), pgbouncer-auth/userlist.txt.
# AUCUN secret de prod : mots de passe et JWT tirés au hasard, clés externes factices (Stripe,
# Resend, Anthropic : aucun appel possible), IA coupée, pas de Tradovate, Discord, Sentry ni VPS.
#
#   cd /opt/infra/load && bash make-env.sh <image API, ex. mtc_api_prod:1a67cbde987a>
set -euo pipefail

IMAGE="${1:?usage: $0 <image de l API>}"
docker image inspect "$IMAGE" >/dev/null || { echo "image absente : $IMAGE" >&2; exit 1; }
[ -f .env ] && { echo ".env existe déjà : environnement déjà préparé (nettoyer d abord)" >&2; exit 1; }

umask 077
rnd() { openssl rand -hex "$1"; }
PG=$(rnd 24); RD=$(rnd 24)

cat > .env <<EOF
LOAD_IMAGE=${IMAGE}
LOAD_PG_PASSWORD=${PG}
LOAD_REDIS_PASSWORD=${RD}
EOF

cat > .env.api <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://mtc_user:${PG}@load_pgbouncer:6432/mytradingcoach_load?pgbouncer=true&connection_limit=1
DATABASE_DIRECT_URL=postgresql://mtc_user:${PG}@load_postgres:5432/mytradingcoach_load
REDIS_HOST=load_redis
REDIS_PORT=6379
REDIS_PASSWORD=${RD}
JWT_SECRET=$(rnd 48)
JWT_REFRESH_SECRET=$(rnd 48)
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
LOAD_TEST_KEY=$(rnd 24)
AI_ENABLED=false
NEWS_TRANSLATION=false
PUSH_ENABLED=false
ANTHROPIC_API_KEY=sk-ant-load-test-factice
RESEND_API_KEY=re_load_test_factice
MAIL_FROM=noreply@mytradingcoach.app
STRIPE_SECRET_KEY=sk_test_load_factice
STRIPE_WEBHOOK_SECRET=whsec_load_factice
STRIPE_PREMIUM_PRICE_MONTHLY_V2=price_load_m
STRIPE_PREMIUM_PRICE_YEARLY_V2=price_load_y
STRIPE_PREMIUM_PRICE_MONTHLY_FOUNDER=price_load_fm
STRIPE_PREMIUM_PRICE_YEARLY_FOUNDER=price_load_fy
FRONTEND_URL=https://app.mytradingcoach.app
LANDING_URL=https://www.mytradingcoach.app
CORS_ORIGINS=https://app.mytradingcoach.app
PUPPETEER_SKIP_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EOF

# PgBouncer (scram) accepte un mot de passe en clair dans userlist.txt ; lu par l'uid 70 du conteneur.
mkdir -p pgbouncer-auth
printf '"mtc_user" "%s"\n' "$PG" > pgbouncer-auth/userlist.txt
# Lisible par l'uid 70 du conteneur ; ce mot de passe ne sert qu'à la base de test, jetée à la fin.
chmod 755 pgbouncer-auth; chmod 644 pgbouncer-auth/userlist.txt

echo "environnement de test prêt (image ${IMAGE}). Clé de test : grep LOAD_TEST_KEY .env.api"
