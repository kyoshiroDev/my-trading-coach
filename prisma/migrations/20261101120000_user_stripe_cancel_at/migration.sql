-- #813 : fin programmée de l'abonnement Stripe (cancel_at, ou fin de période si cancel_at_period_end).
-- Additive, nullable, sans défaut : aucune réécriture de table, pas de rattrapage des lignes existantes.
ALTER TABLE "User" ADD COLUMN "stripeCancelAt" TIMESTAMP(3);
