-- Visites landing : ajout du medium et de la campagne UTM (additif, '' pour les lignes existantes).
-- DropIndex
DROP INDEX "LandingVisitDaily_date_path_source_key";

-- AlterTable
ALTER TABLE "LandingVisitDaily" ADD COLUMN     "campaign" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "medium" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "LandingVisitDaily_date_path_source_medium_campaign_key" ON "LandingVisitDaily"("date", "path", "source", "medium", "campaign");

