-- Contrat de session (#667) : règles que le trader se fixe pour une séance. Table nouvelle, additive.
CREATE TABLE "SessionContract" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxDailyLoss" DOUBLE PRECISION,
    "maxConsecutiveLosses" INTEGER,
    "maxTrades" INTEGER,
    "newsMinutes" INTEGER,
    "allowedAssets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "edits" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionContract_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "SessionContract_userId_createdAt_idx" ON "SessionContract"("userId", "createdAt");

ALTER TABLE "SessionContract" ADD CONSTRAINT "SessionContract_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionContract" ADD CONSTRAINT "SessionContract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
