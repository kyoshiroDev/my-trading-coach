-- Jeu de données de charge (SCA-B9-01) : BASE BETA UNIQUEMENT.
--   2 000 comptes PREMIUM `load-<n>@test.local` (isDemo = false), 1 compte de trading, 3 setups
--   chacun ; trades : compte 1 → 50 000, comptes 2-10 → 10 000, les autres → 2 000
--   (médiane et maximum retenus en A-03), étalés sur 2 ans. Total ≈ 4,1 M trades.
-- Lancement (sur le VPS) :
--   docker exec -i mtc_postgres psql -U mtc_user -d mytradingcoach_beta \
--     -v users=2000 -v pwhash="'<hash argon2>'" < seed-beta.sql
-- Purge : purge-beta.sql. Mot de passe des comptes : README.
\set ON_ERROR_STOP on
\timing on

DO $$ BEGIN
  IF current_database() <> 'mytradingcoach_beta' THEN
    RAISE EXCEPTION 'seed de charge refusé sur %, beta uniquement', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM "User" WHERE email LIKE 'load-%@test.local') THEN
    RAISE EXCEPTION 'comptes de charge déjà présents : lancer purge-beta.sql d''abord';
  END IF;
END $$;

BEGIN;

INSERT INTO "User" (id, email, password, name, plan, "onboardingCompleted", "isDemo", "createdAt", "updatedAt", "lastLoginAt")
SELECT 'load-u-' || n, 'load-' || n || '@test.local', :pwhash, 'Load ' || n, 'PREMIUM', true, false,
       now() - interval '2 years', now(), now()
FROM generate_series(1, :users) n;

INSERT INTO "TradingAccount" (id, "userId", label, "accountSize", "createdAt", "updatedAt")
SELECT 'load-a-' || n, 'load-u-' || n, 'Compte charge', 50000, now() - interval '2 years', now()
FROM generate_series(1, :users) n;

INSERT INTO "Setup" (id, "userId", title, color, "sortOrder", "createdAt", "updatedAt")
SELECT 'load-s-' || n || '-' || k, 'load-u-' || n, (ARRAY['BREAKOUT','PULLBACK','RANGE'])[k],
       (ARRAY['#10b981','#3b82f6','#f59e0b'])[k], k, now() - interval '2 years', now()
FROM generate_series(1, :users) n, generate_series(1, 3) k;

INSERT INTO "Trade" (id, "userId", asset, side, entry, exit, "stopLoss", "takeProfit", pnl, commission,
                     "riskReward", quantity, emotion, "setupId", session, timeframe, tags, "accountId",
                     "tradedAt", "createdAt", source)
SELECT 'load-t-' || u.n || '-' || t.i,
       'load-u-' || u.n,
       (ARRAY['NQ','ES','MNQ','EURUSD','BTCUSD','GC'])[1 + (t.i % 6)],
       (CASE WHEN random() < 0.5 THEN 'LONG' ELSE 'SHORT' END)::"TradeSide",
       e, e + d, e - 20, e + 40,
       round((d * 20 - 2.5)::numeric, 2), 2.5,
       round((1 + random() * 2)::numeric, 2), 1 + (t.i % 3),
       (ARRAY['CONFIDENT','STRESSED','REVENGE','FEAR','FOCUSED','NEUTRAL'])[1 + (t.i % 6)]::"EmotionState",
       'load-s-' || u.n || '-' || (1 + t.i % 3),
       (ARRAY['LONDON','NEW_YORK','ASIAN'])[1 + (t.i % 3)]::"TradingSession",
       '5m', '{}', 'load-a-' || u.n,
       ts, ts, 'MANUAL'
FROM generate_series(1, :users) AS u(n)
CROSS JOIN LATERAL generate_series(1, CASE WHEN u.n = 1 THEN 50000 WHEN u.n <= 10 THEN 10000 ELSE 2000 END) AS t(i)
-- `t.i` référencé : sans lui, Postgres n'évalue la sous-requête qu'UNE fois (mêmes valeurs partout).
CROSS JOIN LATERAL (SELECT 18000 + random() * 2000 + 0 * t.i AS e,
                           (random() - 0.45) * 30 + 0 * t.i AS d,
                           now() - random() * interval '730 days' + 0 * t.i * interval '1 s' AS ts) AS g;

COMMIT;

VACUUM ANALYZE "User", "TradingAccount", "Setup", "Trade";
SELECT count(*) AS trades_charge FROM "Trade" WHERE "userId" LIKE 'load-u-%';
SELECT pg_size_pretty(pg_database_size(current_database())) AS taille_base;
