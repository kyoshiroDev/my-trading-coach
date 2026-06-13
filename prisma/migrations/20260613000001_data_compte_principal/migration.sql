-- Migration de DONNÉES (idempotente) : un « Compte principal » par user actif regroupe
-- tout son historique de trades/sessions, au lieu de laisser accountId à NULL.
-- - Exclut les comptes démo (isDemo = true).
-- - Ne crée un compte que pour un user qui n'en a AUCUN et qui a ≥1 trade ou session.
-- - Ne réaffecte que les trades/sessions à accountId NULL.
-- Relançable sans effet (pas de doublon) : les WHERE garantissent l'idempotence.

-- 1. Créer le « Compte principal » pour chaque user éligible.
INSERT INTO "TradingAccount" ("id", "userId", "label", "type", "status", "currency", "drawdownType", "createdAt", "updatedAt")
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  u."id", 'Compte principal', 'PERSONAL', 'ACTIVE', 'USD', 'STATIC', now(), now()
FROM "User" u
WHERE u."isDemo" = false
  AND NOT EXISTS (SELECT 1 FROM "TradingAccount" a WHERE a."userId" = u."id")
  AND (
    EXISTS (SELECT 1 FROM "Trade" t WHERE t."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "TradeSession" s WHERE s."userId" = u."id")
  );

-- 2. Rattacher les trades à accountId NULL au « Compte principal » de leur user.
UPDATE "Trade" t
SET "accountId" = a."id"
FROM "TradingAccount" a
WHERE t."accountId" IS NULL
  AND a."userId" = t."userId"
  AND a."label" = 'Compte principal'
  AND a."status" = 'ACTIVE';

-- 3. Idem pour les sessions.
UPDATE "TradeSession" s
SET "accountId" = a."id"
FROM "TradingAccount" a
WHERE s."accountId" IS NULL
  AND a."userId" = s."userId"
  AND a."label" = 'Compte principal'
  AND a."status" = 'ACTIVE';
