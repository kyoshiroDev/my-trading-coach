-- Séance prop firm vue en direct + alertes et tilt envoyés (PREMIUM, #373). Additive (N-1 OK).
CREATE TABLE "AccountRiskDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "minDrawdownMargin" DOUBLE PRECISION,
    "minDrawdownAt" TIMESTAMP(3),
    "minDailyLossRemaining" DOUBLE PRECISION,
    "minDailyLossAt" TIMESTAMP(3),
    "floorStart" DOUBLE PRECISION,
    "floorEnd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRiskDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountRiskDay_accountId_tradeDate_key" ON "AccountRiskDay"("accountId", "tradeDate");

ALTER TABLE "AccountRiskDay" ADD CONSTRAINT "AccountRiskDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PropRiskEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropRiskEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropRiskEvent_userId_tradeDate_idx" ON "PropRiskEvent"("userId", "tradeDate");
CREATE INDEX "PropRiskEvent_accountId_tradeDate_idx" ON "PropRiskEvent"("accountId", "tradeDate");

ALTER TABLE "PropRiskEvent" ADD CONSTRAINT "PropRiskEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
