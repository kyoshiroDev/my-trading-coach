-- Engagement landing (défilement, temps passé, sélecteur de règles) : page mesurée dans
-- FunnelEventDaily. Additif : '' pour les lignes existantes (étapes d'inscription), aucune donnée
-- personnelle. Même nom d'index (tronqué à 63 caractères par Prisma), désormais avec "path".

-- DropIndex
DROP INDEX "FunnelEventDaily_date_step_source_medium_campaign_inApp_det_key";

-- AlterTable
ALTER TABLE "FunnelEventDaily" ADD COLUMN     "path" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEventDaily_date_step_source_medium_campaign_inApp_det_key" ON "FunnelEventDaily"("date", "step", "source", "medium", "campaign", "inApp", "detail", "path");
