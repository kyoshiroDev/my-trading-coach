-- #954 : remise filleul −10 % enregistrée au webhook d'abonnement, comptée dans le MRR base.
-- Additive, nullable, compatible N-1 (l'ancienne version ne lit ni n'écrit la colonne).
ALTER TABLE "User" ADD COLUMN "referralDiscountSince" TIMESTAMP(3);
