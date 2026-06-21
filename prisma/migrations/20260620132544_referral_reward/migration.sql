-- AlterTable
ALTER TABLE "EcoEvent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "tradingStrategy" DROP DEFAULT,
ALTER COLUMN "tradingSessions" DROP DEFAULT,
ALTER COLUMN "tradingAssets" DROP DEFAULT,
ALTER COLUMN "pinnedEcoEvents" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "parrainId" TEXT NOT NULL,
    "filleulId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_filleulId_key" ON "ReferralReward"("filleulId");

-- CreateIndex
CREATE INDEX "ReferralReward_parrainId_idx" ON "ReferralReward"("parrainId");

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_parrainId_fkey" FOREIGN KEY ("parrainId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
