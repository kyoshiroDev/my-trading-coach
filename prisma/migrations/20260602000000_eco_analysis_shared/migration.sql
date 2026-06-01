-- CreateTable
CREATE TABLE "EcoAnalysisCache" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "assetsKey" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoAnalysisCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcoAnalysisCache_date_idx" ON "EcoAnalysisCache"("date");

-- CreateIndex
CREATE UNIQUE INDEX "EcoAnalysisCache_date_assetsKey_key" ON "EcoAnalysisCache"("date", "assetsKey");
