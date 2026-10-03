-- Date du dernier payout reçu (début du cycle de payout). Additive.
ALTER TABLE "TradingAccount" ADD COLUMN "lastPayoutAt" DATE;
