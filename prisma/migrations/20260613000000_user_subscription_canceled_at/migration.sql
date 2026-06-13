-- Churn fiable : date de résiliation persistée (set au webhook subscription.deleted,
-- remise à NULL au réabonnement). Champ additif nullable → migration non destructive.
ALTER TABLE "User" ADD COLUMN "subscriptionCanceledAt" TIMESTAMP(3);
