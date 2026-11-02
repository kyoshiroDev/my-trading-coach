-- #684 : date du dernier changement de statut d'un compte (pause de synchro après 48 h).
-- Additive et nullable : aucune réécriture de table, compatible avec l'API N-1.
ALTER TABLE "TradingAccount" ADD COLUMN "statusChangedAt" TIMESTAMP(3);
