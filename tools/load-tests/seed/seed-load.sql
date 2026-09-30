-- Jeu de données de test de charge (PROMPT-136) : 10 000 users, ~2 M trades.
-- NE PAS lancer à la main : passer par `seed-load.sh`, qui vérifie la base cible.
--
-- Idempotent : tout ce qui est créé porte l'email `loadtest-NNNNN@loadtest.invalid`
-- (ou appartient à un tel user). Relancer le script supprime d'abord ces données.
--
-- Répartition réaliste, inégale (quelques gros traders, beaucoup de petits) :
--   1 %  « gros »    : 5 000 – 8 000 trades
--   19 % « moyens »  :   300 –   600 trades
--   80 % « petits »  :     0 –   150 trades
--   → moyenne ≈ 210 trades/user, ≈ 2,1 M trades, sur les 365 derniers jours.
-- 5 % de PREMIUM, 3 setups et 1 à 3 comptes par user, une TradeSession par (user, jour tradé),
-- et une session ACTIVE aujourd'hui pour les 1 200 premiers users (compagnon temps réel).
--
-- Mot de passe de tous les users : LoadTest!2026 (hash argon2id ci-dessous).

\set ON_ERROR_STOP on
\timing on
SET synchronous_commit = off;

-- ── 0. Nettoyage (idempotence) ───────────────────────────────────────────────
-- Trade → Setup est en NoAction : on supprime les trades avant les users.
DELETE FROM "Trade" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE '%@loadtest.invalid');
DELETE FROM "User" WHERE email LIKE '%@loadtest.invalid';

-- ── 1. Users ────────────────────────────────────────────────────────────────
INSERT INTO "User" (id, email, password, name, role, plan, "onboardingCompleted", market,
                    "tradingAssets", "favoriteAsset", "createdAt", "updatedAt", "lastSeenAt")
SELECT 'lt_u_' || lpad(i::text, 5, '0'),
       'loadtest-' || lpad(i::text, 5, '0') || '@loadtest.invalid',
       '$argon2id$v=19$m=65536,t=3,p=4$mQc8i3sElYQ+wNTNspV2vA$AHgVmghhjJMX0x9jPrUkENrqo9B3DozL+wXQb71KQzw',
       'Load ' || i,
       'USER',
       (CASE WHEN i % 20 = 0 THEN 'PREMIUM' ELSE 'FREE' END)::"Plan",
       true,
       'FUTURES',
       ARRAY['NQ','ES','MNQ'],
       'NQ',
       now() - (random() * interval '365 days'),
       now(),
       now() - (random() * interval '7 days')
FROM generate_series(1, 10000) AS i;

-- ── 2. Setups (3 par user) ───────────────────────────────────────────────────
INSERT INTO "Setup" (id, "userId", title, color, "sortOrder", "createdAt", "updatedAt")
SELECT 'lt_s_' || substr(u.id, 6) || '_' || s, u.id,
       (ARRAY['BREAKOUT','PULLBACK','REVERSAL'])[s], '#10b981', s, now(), now()
FROM "User" u CROSS JOIN generate_series(1, 3) AS s
WHERE u.email LIKE '%@loadtest.invalid';

-- ── 3. Comptes (1 à 3 par user) ──────────────────────────────────────────────
INSERT INTO "TradingAccount" (id, "userId", label, broker, type, status, "accountSize",
                              "startingBalance", "profitTarget", "maxDrawdown", "createdAt", "updatedAt")
SELECT 'lt_a_' || substr(u.id, 6) || '_' || a, u.id, 'Apex 50k #' || a, 'Apex',
       (CASE WHEN a = 1 THEN 'FUNDED' ELSE 'EVALUATION' END)::"AccountType",
       'ACTIVE', 50000, 50000, 3000, 2500, now(), now()
FROM "User" u CROSS JOIN generate_series(1, 3) AS a
WHERE u.email LIKE '%@loadtest.invalid'
  AND a <= 1 + (hashtext(u.id) & 1) + (hashtext(u.id || 'x') & 1);

-- ── 4. Trades (~2,1 M) ───────────────────────────────────────────────────────
-- Nombre de trades par user selon son palier ; chaque trade tombe sur un jour ouvré
-- des 365 derniers jours, dans la fenêtre 15h30 – 17h30 Paris (ouverture US).
CREATE TEMP TABLE lt_counts AS
SELECT u.id AS user_id,
       row_number() OVER (ORDER BY u.id) AS rn,
       CASE
         WHEN r < 0.01 THEN 5000 + floor(random() * 3000)::int
         WHEN r < 0.20 THEN 300 + floor(random() * 300)::int
         ELSE floor(random() * 150)::int
       END AS n
FROM (SELECT id, random() AS r FROM "User" WHERE email LIKE '%@loadtest.invalid') u;

INSERT INTO "Trade" (id, "userId", asset, side, entry, exit, "stopLoss", "takeProfit", pnl, commission,
                     "riskReward", quantity, emotion, "setupId", session, timeframe, tags, "accountId",
                     "tradedAt", "createdAt", source, "executionScore", "executionGrade")
SELECT 'lt_t_' || substr(c.user_id, 6) || '_' || g,
       c.user_id,
       (ARRAY['NQ','ES','MNQ','MES','CL'])[1 + (g % 5)],
       (CASE WHEN g % 2 = 0 THEN 'LONG' ELSE 'SHORT' END)::"TradeSide",
       18000 + random() * 1000,
       18000 + random() * 1000,
       17950 + random() * 1000,
       18050 + random() * 1000,
       round((random() * 800 - 350)::numeric, 2)::float8,
       4.5,
       round((random() * 3)::numeric, 2)::float8,
       1 + floor(random() * 3),
       (ARRAY['CONFIDENT','STRESSED','REVENGE','FEAR','FOCUSED','NEUTRAL'])[1 + floor(random() * 6)::int]::"EmotionState",
       'lt_s_' || substr(c.user_id, 6) || '_' || (1 + g % 3),
       'NEW_YORK',
       '1m',
       ARRAY[]::text[],
       'lt_a_' || substr(c.user_id, 6) || '_1',
       d.day + interval '13 hours 30 minutes' + random() * interval '2 hours',
       now(),
       (CASE WHEN g % 4 = 0 THEN 'CSV_IMPORT' ELSE 'MANUAL' END)::"TradeSource",
       floor(random() * 100)::int,
       (ARRAY['EXCELLENT','BON','MOYEN','MAUVAIS'])[1 + floor(random() * 4)::int]::"ExecutionGrade"
FROM lt_counts c
CROSS JOIN LATERAL generate_series(1, c.n) AS g
CROSS JOIN LATERAL (
  -- Jour pseudo-aléatoire : les trades récents sont plus denses (les users actifs tradent).
  -- `g * 0` rend la sous-requête corrélée : sans lui, Postgres ne l'évalue qu'UNE fois
  -- et tous les trades tombent le même jour.
  SELECT date_trunc('day', now() - ((floor(power(random(), 1.5) * 365) + g * 0) || ' days')::interval) AS day
) d;

-- ── 5. Sessions : une TradeSession CLOSED par (user, jour tradé) ────────────
INSERT INTO "TradeSession" (id, "userId", "startedAt", "endedAt", status, "totalTrades", "totalPnl",
                            "moodStart", "accountId", "createdAt")
SELECT 'lt_ss_' || substr(t."userId", 6) || '_' || to_char(date_trunc('day', t."tradedAt"), 'YYYYMMDD'),
       t."userId",
       min(t."tradedAt") - interval '5 minutes',
       max(t."tradedAt") + interval '5 minutes',
       'CLOSED', count(*), sum(t.pnl), 'FOCUSED',
       'lt_a_' || substr(t."userId", 6) || '_1',
       min(t."tradedAt")
FROM "Trade" t
WHERE t."userId" LIKE 'lt_u_%' AND t."tradedAt" < date_trunc('day', now())
GROUP BY t."userId", date_trunc('day', t."tradedAt");

UPDATE "Trade" t
SET "sessionId" = 'lt_ss_' || substr(t."userId", 6) || '_' || to_char(date_trunc('day', t."tradedAt"), 'YYYYMMDD')
WHERE t."userId" LIKE 'lt_u_%' AND t."tradedAt" < date_trunc('day', now());

-- Session ACTIVE du jour pour les 1 200 premiers users (compagnon temps réel au pic).
-- Les trades du jour (s'il y en a) y sont rattachés.
INSERT INTO "TradeSession" (id, "userId", "startedAt", status, "moodStart", "accountId", "createdAt")
SELECT 'lt_ss_' || substr(u.id, 6) || '_live', u.id, now() - interval '30 minutes', 'ACTIVE', 'FOCUSED',
       'lt_a_' || substr(u.id, 6) || '_1', now()
FROM "User" u
WHERE u.email LIKE '%@loadtest.invalid' AND u.id <= 'lt_u_01200';

UPDATE "Trade" t SET "sessionId" = 'lt_ss_' || substr(t."userId", 6) || '_live'
WHERE t."userId" LIKE 'lt_u_%' AND t."userId" <= 'lt_u_01200' AND t."tradedAt" >= date_trunc('day', now());

DROP TABLE lt_counts;

ANALYZE "User"; ANALYZE "Trade"; ANALYZE "TradeSession"; ANALYZE "Setup"; ANALYZE "TradingAccount";

-- ── Bilan ───────────────────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM "User"  WHERE email LIKE '%@loadtest.invalid') AS users,
       (SELECT count(*) FROM "Trade" WHERE "userId" LIKE 'lt_u_%')          AS trades,
       (SELECT count(*) FROM "TradeSession" WHERE "userId" LIKE 'lt_u_%')   AS sessions,
       (SELECT max(c) FROM (SELECT count(*) c FROM "Trade" WHERE "userId" LIKE 'lt_u_%' GROUP BY "userId") x) AS max_trades_user,
       pg_size_pretty(pg_database_size(current_database())) AS db_size;
