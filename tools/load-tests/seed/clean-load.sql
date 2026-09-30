-- Supprime tout le jeu de données de test de charge (users `@loadtest.invalid` et leurs données).
-- Trade → Setup est en NoAction : les trades partent avant les users (qui cascadent le reste).
\set ON_ERROR_STOP on
\timing on
DELETE FROM "Trade" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE '%@loadtest.invalid');
DELETE FROM "User" WHERE email LIKE '%@loadtest.invalid';
VACUUM ANALYZE "Trade";
