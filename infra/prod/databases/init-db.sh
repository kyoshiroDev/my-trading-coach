#!/bin/bash
# Premier démarrage seulement (volume vide). mtc_admin = superuser (POSTGRES_USER) ;
# mtc_user = rôle de l API, NON superuser, propriétaire de la base prod (migrations Prisma OK).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
  CREATE ROLE mtc_user LOGIN PASSWORD '${MTC_USER_PASSWORD}';
  CREATE DATABASE mytradingcoach_prod OWNER mtc_user;
  REVOKE ALL ON DATABASE mytradingcoach_prod FROM PUBLIC;
  GRANT CONNECT, TEMPORARY ON DATABASE mytradingcoach_prod TO mtc_user;
  -- Lecture seule (diagnostic) : utilisable uniquement via docker exec (local trust), jamais en réseau.
  CREATE ROLE mtc_readonly LOGIN;
  GRANT pg_read_all_data, pg_read_all_stats TO mtc_readonly;
  ALTER ROLE mtc_readonly SET default_transaction_read_only = on;
  GRANT CONNECT ON DATABASE mytradingcoach_prod TO mtc_readonly;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname mytradingcoach_prod <<EOSQL
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  ALTER SCHEMA public OWNER TO mtc_user;
EOSQL
