-- Parcours d'inscription par source (additif, aucune donnée personnelle).

-- Visites landing : navigateur intégré (Instagram, Facebook, TikTok…), false pour les lignes existantes.
-- DropIndex
DROP INDEX "LandingVisitDaily_date_path_source_medium_campaign_key";

-- AlterTable
ALTER TABLE "LandingVisitDaily" ADD COLUMN     "inApp" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "LandingVisitDaily_date_path_source_medium_campaign_inApp_key" ON "LandingVisitDaily"("date", "path", "source", "medium", "campaign", "inApp");

-- CreateTable
CREATE TABLE "FunnelEventDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "step" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "medium" TEXT NOT NULL DEFAULT '',
    "campaign" TEXT NOT NULL DEFAULT '',
    "inApp" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FunnelEventDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEventDaily_date_step_source_medium_campaign_inApp_det_key" ON "FunnelEventDaily"("date", "step", "source", "medium", "campaign", "inApp", "detail");
