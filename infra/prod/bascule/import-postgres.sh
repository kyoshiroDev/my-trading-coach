#!/usr/bin/env bash
# Bascule VPS prod — importe un dump pg_dump (format custom, lu sur l'entrée standard) dans <base>
# du Postgres du VPS prod. La base est RECRÉÉE (supprimée si elle existe), propriétaire mtc_user.
#
#   ssh greg@51.83.197.230 "docker exec mtc_postgres pg_dump -U mtc_readonly -Fc mytradingcoach_prod" \
#     | ssh greg@149.202.40.240 "bash /opt/infra/bascule/import-postgres.sh mytradingcoach_prod"
#
# Répétition : même commande avec une autre base (ex. mytradingcoach_repetition), puis la supprimer.
set -euo pipefail

DB="${1:?usage: $0 <base>}"
[[ "$DB" =~ ^[a-z_]+$ ]] || { echo "nom de base invalide : $DB" >&2; exit 2; }
admin() { docker exec -i mtc_postgres psql -v ON_ERROR_STOP=1 -q -U mtc_admin "$@"; }

echo "[import-postgres] $(date +%T) recréation de ${DB}"
admin -d postgres <<SQL
DROP DATABASE IF EXISTS ${DB} WITH (FORCE);
CREATE DATABASE ${DB} OWNER mtc_user;
REVOKE ALL ON DATABASE ${DB} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${DB} TO mtc_user;
GRANT CONNECT ON DATABASE ${DB} TO mtc_readonly;
SQL

echo "[import-postgres] $(date +%T) restauration (propriétaire mtc_user)"
docker exec -i mtc_postgres pg_restore -U mtc_user -d "$DB" --no-owner --no-privileges --exit-on-error

admin -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
admin -d "$DB" -c "ANALYZE;"

echo "[import-postgres] $(date +%T) contrôle"
docker exec mtc_postgres psql -U mtc_readonly -d "$DB" -At -c "
  SELECT 'users='       || (SELECT count(*) FROM \"User\")
      || ' trades='     || (SELECT count(*) FROM \"Trade\")
      || ' migrations=' || (SELECT count(*) FROM _prisma_migrations)
      || ' taille='     || pg_size_pretty(pg_database_size(current_database()));"
echo "[import-postgres] $(date +%T) OK"
