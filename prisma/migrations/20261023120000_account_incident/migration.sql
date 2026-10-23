-- Autopsie d'un compte grillé (#669) : une table nouvelle, purement additive et compatible N-1
-- (l'ancien code ne la lit pas). Cascade à la suppression du compte.

-- CreateTable
CREATE TABLE "AccountIncident" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "data" JSONB,
    "failedByIncidentAt" TIMESTAMP(3),
    "aiAnalysis" TEXT,
    "aiGeneratedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountIncident_userId_createdAt_idx" ON "AccountIncident"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountIncident_accountId_kind_period_key" ON "AccountIncident"("accountId", "kind", "period");

-- AddForeignKey
ALTER TABLE "AccountIncident" ADD CONSTRAINT "AccountIncident_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
