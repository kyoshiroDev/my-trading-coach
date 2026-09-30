#!/usr/bin/env bash
# Seed / nettoyage du jeu de données de test de charge (PROMPT-136).
#
#   LOAD_TEST_DATABASE_URL=postgresql://…/mtc_dev ./tools/load-tests/seed/seed-load.sh          # seed
#   LOAD_TEST_DATABASE_URL=postgresql://…/mtc_dev ./tools/load-tests/seed/seed-load.sh --clean  # nettoyage
#
# Garde-fous : refuse toute URL qui ressemble à la prod. La base doit s'appeler *dev*, *load* ou *test*,
# et l'hôte ne doit pas être un hôte de prod connu. Ne lit JAMAIS DATABASE_URL (pour ne pas viser
# par erreur la base de l'API chargée dans l'environnement).
set -euo pipefail

URL="${LOAD_TEST_DATABASE_URL:-}"
if [[ -z "$URL" ]]; then
  echo "LOAD_TEST_DATABASE_URL manquante." >&2; exit 1
fi
DB_NAME="${URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
if [[ "$URL" =~ prod ]] || [[ ! "$DB_NAME" =~ (dev|load|test) ]]; then
  echo "Refus : '$DB_NAME' ne ressemble pas à une base dev/load/test (ou l'URL contient 'prod')." >&2; exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == "--clean" ]]; then
  psql "$URL" -v ON_ERROR_STOP=1 -f "$DIR/clean-load.sql"
else
  psql "$URL" -v ON_ERROR_STOP=1 -f "$DIR/seed-load.sql"
fi
