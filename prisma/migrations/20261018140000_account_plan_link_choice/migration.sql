-- Liaison compte ↔ plan prop firm (#612) : réponse à « Quel est ce compte ? » quand aucun plan
-- n'est relié. Colonnes nullables, additive (compatible N-1).

-- CreateEnum
CREATE TYPE "PlanLinkChoice" AS ENUM ('LATER', 'PERSONAL', 'UNLISTED');

-- AlterTable
ALTER TABLE "TradingAccount" ADD COLUMN "planLinkChoice" "PlanLinkChoice",
ADD COLUMN "unlistedFirm" TEXT;
