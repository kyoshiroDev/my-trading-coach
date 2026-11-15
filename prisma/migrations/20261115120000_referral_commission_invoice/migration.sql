-- A1 (#1013) : une commission ambassadeur par FACTURE Stripe, plus par (abonnement, mois).
-- La 1re facture et le 1er renouvellement (ou un prorata) du même mois partageaient la clé :
-- la 2e écrasait la 1re. Compatible N-1 : colonne nullable (l'ancienne version ne l'écrit pas),
-- l'unicité (abonnement, mois) devient un simple index (l'ancien upsert, qui s'appuyait dessus,
-- ne tourne plus après le déploiement ; prod au 14/11 : 0 commission).
ALTER TABLE "ReferralCommission" ADD COLUMN "invoiceId" TEXT;
CREATE UNIQUE INDEX "ReferralCommission_invoiceId_key" ON "ReferralCommission"("invoiceId");
DROP INDEX "ReferralCommission_subscriptionId_period_key";
CREATE INDEX "ReferralCommission_subscriptionId_period_idx" ON "ReferralCommission"("subscriptionId", "period");
