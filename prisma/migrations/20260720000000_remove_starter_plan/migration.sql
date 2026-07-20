-- PROMPT-169 : bascule tarifaire — suppression du palier STARTER (enum Plan → FREE | PREMIUM).
-- Aucun abonné payant à ce jour → pas de grandfathering. Les comptes admin/démo/tests en STARTER
-- deviennent PREMIUM. On convertit AUSSI DeletedAccount.plan (contrainte enum : la valeur disparaît).

-- 1. Réaffecter les lignes STARTER avant de retirer la valeur de l'enum.
UPDATE "User" SET "plan" = 'PREMIUM' WHERE "plan" = 'STARTER';
UPDATE "DeletedAccount" SET "plan" = 'PREMIUM' WHERE "plan" = 'STARTER';

-- 2. Recréer l'enum sans STARTER et migrer les colonnes qui l'utilisent.
ALTER TABLE "User" ALTER COLUMN "plan" DROP DEFAULT;
CREATE TYPE "Plan_new" AS ENUM ('FREE', 'PREMIUM');
ALTER TABLE "User" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
ALTER TABLE "DeletedAccount" ALTER COLUMN "plan" TYPE "Plan_new" USING ("plan"::text::"Plan_new");
ALTER TYPE "Plan" RENAME TO "Plan_old";
ALTER TYPE "Plan_new" RENAME TO "Plan";
DROP TYPE "Plan_old";
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE';
