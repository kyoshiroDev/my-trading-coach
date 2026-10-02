-- Catalogue des règles prop firm (miroir de libs/shared/src/prop-firm-rules, synchronisé au démarrage de l'API)
-- + lien optionnel TradingAccount -> plan du catalogue. Purement additif : aucune réécriture de table.
-- AlterTable
ALTER TABLE "TradingAccount" ADD COLUMN     "propFirmPlanId" TEXT;

-- CreateTable
CREATE TABLE "PropFirm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "helpCenter" TEXT,
    "platforms" TEXT[],
    "verifiedAt" DATE NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropFirm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmPlan" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "accountSize" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "configuration" JSONB,
    "price" JSONB NOT NULL,
    "phases" JSONB NOT NULL,
    "sourceUrls" TEXT[],
    "needsReview" BOOLEAN NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropFirmPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropFirmPlan_firmId_active_idx" ON "PropFirmPlan"("firmId", "active");

-- CreateIndex
CREATE INDEX "TradingAccount_propFirmPlanId_idx" ON "TradingAccount"("propFirmPlanId");

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_propFirmPlanId_fkey" FOREIGN KEY ("propFirmPlanId") REFERENCES "PropFirmPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmPlan" ADD CONSTRAINT "PropFirmPlan_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "PropFirm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

