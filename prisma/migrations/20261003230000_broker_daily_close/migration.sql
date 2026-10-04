-- Soldes de clôture officiels par journée de trading (rapport Account Balance History). Additive.
CREATE TABLE "BrokerDailyClose" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "closingBalance" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerDailyClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerDailyClose_accountId_tradeDate_key" ON "BrokerDailyClose"("accountId", "tradeDate");

ALTER TABLE "BrokerDailyClose" ADD CONSTRAINT "BrokerDailyClose_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
