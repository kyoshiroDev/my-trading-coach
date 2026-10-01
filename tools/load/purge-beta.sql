-- Purge du jeu de charge (SCA-B9) : BASE BETA UNIQUEMENT. Supprime les comptes load-*@test.local
-- (seed-beta.sql et inscriptions de signup-wave.js) ; trades, setups et comptes suivent en cascade.
\set ON_ERROR_STOP on
\timing on
DO $$ BEGIN
  IF current_database() <> 'mytradingcoach_beta' THEN
    RAISE EXCEPTION 'purge refusée sur %, beta uniquement', current_database();
  END IF;
END $$;
DELETE FROM "User" WHERE email LIKE 'load-%@test.local';
VACUUM ANALYZE "User", "TradingAccount", "Setup", "Trade";
SELECT pg_size_pretty(pg_database_size(current_database())) AS taille_base;
