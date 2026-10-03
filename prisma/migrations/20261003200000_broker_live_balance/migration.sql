-- Solde et equity du compte lus chez le broker (feature « solde en direct »). Purement additive.
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerCashBalance" DOUBLE PRECISION;
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerCashBalanceAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerNetLiq" DOUBLE PRECISION;
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerOpenPnl" DOUBLE PRECISION;
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerEquityAt" TIMESTAMP(3);
ALTER TABLE "BrokerConnection" ADD COLUMN "brokerOpenPositions" INTEGER NOT NULL DEFAULT 0;
