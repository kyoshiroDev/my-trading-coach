-- Suppression de compte bloquee par le parrainage.
--
-- `ReferralCommission.ambassadorId` et `ReferralReward.parrainId` etaient les deux
-- seules FK vers "User" sans regle onDelete : Postgres appliquait donc RESTRICT. Un
-- ambassadeur porteur d'une commission, ou un parrain porteur d'un mois offert, ne
-- pouvait PLUS supprimer son compte — `archiveAndDelete` echouait sur violation de
-- contrainte, et le front n'affichait rien (corrige separement).
--
-- Cascade aligne ces deux relations sur les 9 autres vers "User". Aucun rapport ne lit
-- de commission orpheline : les lectures filtrent par ambassadeur, et l'agregat admin
-- part de `user.findMany`. La trace analytique du depart vit dans "DeletedAccount".

ALTER TABLE "ReferralCommission" DROP CONSTRAINT "ReferralCommission_ambassadorId_fkey";
ALTER TABLE "ReferralCommission"
  ADD CONSTRAINT "ReferralCommission_ambassadorId_fkey"
  FOREIGN KEY ("ambassadorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralReward" DROP CONSTRAINT "ReferralReward_parrainId_fkey";
ALTER TABLE "ReferralReward"
  ADD CONSTRAINT "ReferralReward_parrainId_fkey"
  FOREIGN KEY ("parrainId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
