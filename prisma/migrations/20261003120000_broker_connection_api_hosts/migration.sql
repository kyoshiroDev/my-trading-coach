-- Hôtes Tradovate dynamiques (apiHosts) : changement d'infra NinjaTrader du 2026-10-03.
ALTER TABLE "BrokerConnection" ADD COLUMN "apiHosts" JSONB;
ALTER TABLE "BrokerConnection" ADD COLUMN "apiHostsAt" TIMESTAMP(3);
