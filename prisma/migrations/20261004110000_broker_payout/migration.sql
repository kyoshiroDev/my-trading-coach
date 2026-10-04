-- Payouts détectés chez le broker (Cash History) + curseur de détection. Additive.
CREATE TABLE "BrokerPayout" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "changeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerPayout_accountId_transactionId_key" ON "BrokerPayout"("accountId", "transactionId");
CREATE INDEX "BrokerPayout_accountId_tradeDate_idx" ON "BrokerPayout"("accountId", "tradeDate");

ALTER TABLE "BrokerPayout" ADD CONSTRAINT "BrokerPayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrokerConnection" ADD COLUMN "payoutsCheckedThrough" DATE;
