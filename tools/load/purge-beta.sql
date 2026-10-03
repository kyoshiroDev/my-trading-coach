-- Purge du jeu de charge (SCA-B9) : BASES BETA OU DEV UNIQUEMENT (jamais la prod). Supprime les comptes load-*@test.local
-- (seed-beta.sql et inscriptions de signup-wave.js) ; trades, setups et comptes suivent en cascade.
\set ON_ERROR_STOP on
\timing on
DO $$ BEGIN
  -- Beta ou dev (2026-10-03 : les PR partent vers dev, B9 se joue aussi sur dev). JAMAIS la prod.
  IF current_database() NOT IN ('mytradingcoach_beta', 'mytradingcoach_dev') THEN
    RAISE EXCEPTION 'purge refusée sur %, beta ou dev uniquement', current_database();
  END IF;
END $$;
DELETE FROM "User" WHERE email LIKE 'load-%@test.local';
VACUUM ANALYZE "User", "TradingAccount", "Setup", "Trade";
SELECT pg_size_pretty(pg_database_size(current_database())) AS taille_base;
