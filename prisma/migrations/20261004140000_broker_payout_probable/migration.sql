-- Payouts « probables » (ajustement manuel négatif, compte funded) et payouts écartés par l'utilisateur.
ALTER TABLE "BrokerPayout" ADD COLUMN "confidence" TEXT NOT NULL DEFAULT 'certain';
ALTER TABLE "BrokerPayout" ADD COLUMN "dismissedAt" TIMESTAMP(3);

-- Relecture complète de l'historique de trésorerie au prochain passage : les ajustements déjà
-- dépassés par le curseur (ignorés par la règle précédente) doivent être réexaminés.
UPDATE "BrokerConnection" SET "payoutsCheckedThrough" = NULL;
