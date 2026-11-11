-- Analyse IA des annonces publiées, gardée après leur journée (calendrier éco, jours passés).
-- Additive : nouvelle table seule, aucune table existante modifiée, compatible avec l'API N-1.

-- CreateTable
CREATE TABLE "EcoReleaseAnalysis" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "assetsKey" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoReleaseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EcoReleaseAnalysis_date_eventName_assetsKey_key" ON "EcoReleaseAnalysis"("date", "eventName", "assetsKey");
