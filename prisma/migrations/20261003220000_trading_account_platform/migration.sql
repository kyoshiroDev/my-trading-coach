-- Plateforme de trading du compte (règles qui en dépendent, ex. verrouillage Apex). Additive.
ALTER TABLE "TradingAccount" ADD COLUMN "platform" TEXT;
