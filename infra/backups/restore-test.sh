#!/bin/bash
# Test de restauration (SCA-B7-09) : prouve qu'une sauvegarde B2 redonne une base utilisable.
#
# 1. Restaure le dernier instantané restic dans un dossier temporaire.
# 2. Charge le dernier dump PROD dans un Postgres JETABLE (conteneur temporaire, jamais mtc_postgres).
# 3. Compare users et trades avec la prod (lecture seule).
# 4. Supprime conteneur et fichiers.
# À lancer après chaque changement de la sauvegarde, et au moins une fois par trimestre.
set -euo pipefail

WORK=$(mktemp -d /tmp/mtc-restore-XXXXXX)
PG=mtc_restore_test_$$
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

/opt/backups/offsite.sh restore latest "$WORK" >/dev/null
DUMP=$(ls -1t "$WORK"/data/mtc/mtc_prod_*_auto.sql.gz 2>/dev/null | head -1)
[ -n "$DUMP" ] || { echo "❌ aucun dump prod dans l'instantané"; exit 1; }
echo "Dump restauré depuis B2 : $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"

docker run -d --name "$PG" -e POSTGRES_PASSWORD=restore -e POSTGRES_USER=mtc_user -e POSTGRES_DB=mtc_restore_test postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$PG" pg_isready -U mtc_user >/dev/null 2>&1 && break; sleep 1; done
gunzip -c "$DUMP" | docker exec -i "$PG" psql -q -U mtc_user -d mtc_restore_test >/dev/null 2>"$WORK/psql.err" || true
ERRORS=$(grep -c ERROR "$WORK/psql.err" || true)

count() { docker exec "$1" psql -U "${3:-mtc_user}" -d "$2" -At -c "SELECT (SELECT count(*) FROM \"User\") || ' users · ' || (SELECT count(*) FROM \"Trade\") || ' trades';"; }
RESTORED=$(count "$PG" mtc_restore_test)
LIVE_USER=$(docker exec mtc_postgres printenv POSTGRES_USER)
LIVE=$(docker exec -e PGOPTIONS='-c default_transaction_read_only=on' mtc_postgres psql -U "$LIVE_USER" -d mytradingcoach_prod -At -c "SELECT (SELECT count(*) FROM \"User\") || ' users · ' || (SELECT count(*) FROM \"Trade\") || ' trades';")

echo "Base restaurée : $RESTORED (erreurs de chargement : $ERRORS)"
echo "Prod actuelle  : $LIVE"
[ "$ERRORS" = 0 ] && [ -n "$RESTORED" ] || { echo "❌ restauration incomplète"; exit 1; }
echo "✅ Restauration OK (écart éventuel = activité depuis le dump de la nuit)"
