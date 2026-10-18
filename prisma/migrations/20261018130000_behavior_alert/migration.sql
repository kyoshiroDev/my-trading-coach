-- Détecteurs de comportement (#602) : alertes enregistrées en silence. Table nouvelle, additive.

-- CreateTable
CREATE TABLE "BehaviorAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "tradeDay" DATE NOT NULL,
    "sessionId" TEXT,
    "tradeId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "mutedByUser" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BehaviorAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BehaviorAlert_userId_createdAt_idx" ON "BehaviorAlert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BehaviorAlert_accountId_tradeDay_idx" ON "BehaviorAlert"("accountId", "tradeDay");

-- CreateIndex
CREATE INDEX "BehaviorAlert_sessionId_idx" ON "BehaviorAlert"("sessionId");

-- CreateIndex
CREATE INDEX "BehaviorAlert_tradeId_idx" ON "BehaviorAlert"("tradeId");

-- AddForeignKey
ALTER TABLE "BehaviorAlert" ADD CONSTRAINT "BehaviorAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviorAlert" ADD CONSTRAINT "BehaviorAlert_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviorAlert" ADD CONSTRAINT "BehaviorAlert_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BehaviorAlert" ADD CONSTRAINT "BehaviorAlert_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
