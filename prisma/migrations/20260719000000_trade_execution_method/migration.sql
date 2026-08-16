-- PROMPT-168 : traçabilité du barème d'exécution (STOP_BASED / BEHAVIORAL)
CREATE TYPE "ExecutionMethod" AS ENUM ('STOP_BASED', 'BEHAVIORAL');

ALTER TABLE "Trade" ADD COLUMN "executionMethod" "ExecutionMethod";

-- Backfill : les trades déjà notés l'ont été par le barème A (intrinsèque, PROMPT-161).
-- Les trades sans stop seront recalculés en BEHAVIORAL par recomputeBehavioralGrades (activité compte).
UPDATE "Trade" SET "executionMethod" = 'STOP_BASED' WHERE "executionGrade" IS NOT NULL;
