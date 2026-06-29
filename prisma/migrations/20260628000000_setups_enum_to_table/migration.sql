-- Migration enum SetupType -> table Setup (par utilisateur), zéro régression.
-- Exécutée en une transaction par Prisma : seed des défauts, remap des trades,
-- puis verrouillage (NOT NULL + FK) et suppression de l'ancienne colonne/enum.

-- 1) Table Setup
CREATE TABLE "Setup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Setup_userId_archived_idx" ON "Setup"("userId", "archived");
CREATE INDEX "Setup_userId_sortOrder_idx" ON "Setup"("userId", "sortOrder");
ALTER TABLE "Setup" ADD CONSTRAINT "Setup_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Colonne Trade.setupId temporairement nullable
ALTER TABLE "Trade" ADD COLUMN "setupId" TEXT;

-- 3) Seed des 6 setups par défaut pour CHAQUE user (couleurs/descriptions d'origine)
INSERT INTO "Setup" ("id", "userId", "title", "color", "description", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", d.title, d.color, d.description, d.ord, now(), now()
FROM "User" u
CROSS JOIN (VALUES
    ('Breakout', '#10b981', 'Cassure d''un niveau clé avec volume', 0),
    ('Pullback', '#3b82f6', 'Repli sur support/EMA puis reprise', 1),
    ('Range',    '#f59e0b', 'Trade entre support et résistance', 2),
    ('Reversal', '#ef4444', 'Retournement sur extrême + divergence', 3),
    ('Scalping', '#8b5cf6', 'Entrées rapides sur petits mouvements', 4),
    ('News',     '#60a5fa', 'Trade sur publication économique', 5)
) AS d(title, color, description, ord);

-- 4) Remap des trades : setupId = setup du même user dont le titre correspond à l'ancien enum
UPDATE "Trade" t
SET "setupId" = s."id"
FROM "Setup" s
WHERE s."userId" = t."userId"
  AND s.title = CASE t.setup
      WHEN 'BREAKOUT' THEN 'Breakout'
      WHEN 'PULLBACK' THEN 'Pullback'
      WHEN 'RANGE'    THEN 'Range'
      WHEN 'REVERSAL' THEN 'Reversal'
      WHEN 'SCALPING' THEN 'Scalping'
      WHEN 'NEWS'     THEN 'News'
  END;

-- 5) Verrouillage : NOT NULL + FK + index, puis suppression de l'ancienne colonne/enum
ALTER TABLE "Trade" ALTER COLUMN "setupId" SET NOT NULL;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_setupId_fkey"
    FOREIGN KEY ("setupId") REFERENCES "Setup"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "Trade_userId_setupId_idx" ON "Trade"("userId", "setupId");

DROP INDEX "Trade_userId_setup_idx";
ALTER TABLE "Trade" DROP COLUMN "setup";
DROP TYPE "SetupType";
