-- PROMPT-161 — Note d'exécution CALCULÉE (déterministe, zéro IA, indépendante du P&L).
-- Ajoute executionScore (0-100, null si < 2 critères) + executionGrade, et backfill l'existant
-- avec EXACTEMENT la même logique que common/utils/execution-grade.util.ts
-- (stop 35 · R:R 25 · émotion effective 20 · risque 20 ; renormalisation sur les poids applicables).

-- CreateEnum
CREATE TYPE "ExecutionGrade" AS ENUM ('EXCELLENT', 'BON', 'MOYEN', 'MAUVAIS');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "executionScore" INTEGER;
ALTER TABLE "Trade" ADD COLUMN "executionGrade" "ExecutionGrade";

-- Backfill déterministe (idempotent : recalcul complet, aucune donnée IA)
WITH base AS (
  SELECT
    t.id, t.side, t."exit", t."stopLoss", t."capitalEngaged",
    COALESCE(
      t."riskReward",
      CASE WHEN t.entry IS NOT NULL AND t."stopLoss" IS NOT NULL AND t."takeProfit" IS NOT NULL
                AND ABS(t.entry - t."stopLoss") > 0
           THEN ABS(t."takeProfit" - t.entry) / ABS(t.entry - t."stopLoss") END
    ) AS rr_val,
    COALESCE(t.emotion::text, ts."moodStart"::text) AS eff_emotion,
    COALESCE(a."startingBalance", a."accountSize") AS capital
  FROM "Trade" t
  LEFT JOIN "TradeSession" ts ON ts.id = t."sessionId"
  LEFT JOIN "TradingAccount" a ON a.id = t."accountId"
),
crit AS (
  SELECT id,
    CASE WHEN "stopLoss" IS NULL OR "exit" IS NULL THEN NULL
         WHEN side = 'SHORT' THEN (CASE WHEN "exit" <= "stopLoss" THEN 1.0 ELSE 0.0 END)
         ELSE (CASE WHEN "exit" >= "stopLoss" THEN 1.0 ELSE 0.0 END) END AS f_stop,
    CASE WHEN rr_val IS NULL THEN NULL
         WHEN rr_val >= 1.5 THEN 1.0 WHEN rr_val >= 1.0 THEN 0.5 ELSE 0.0 END AS f_rr,
    CASE WHEN eff_emotion IN ('CONFIDENT','FOCUSED','NEUTRAL') THEN 1.0
         WHEN eff_emotion IN ('STRESSED','REVENGE','FEAR','TIRED') THEN 0.0 ELSE NULL END AS f_emo,
    CASE WHEN "capitalEngaged" IS NULL OR capital IS NULL OR capital <= 0 THEN NULL
         WHEN ("capitalEngaged" / capital) * 100 <= 1 THEN 1.0
         WHEN ("capitalEngaged" / capital) * 100 <= 2 THEN 0.5 ELSE 0.0 END AS f_risk
  FROM base
),
scored AS (
  SELECT id,
    (CASE WHEN f_stop IS NULL THEN 0 ELSE 35 END)
      + (CASE WHEN f_rr IS NULL THEN 0 ELSE 25 END)
      + (CASE WHEN f_emo IS NULL THEN 0 ELSE 20 END)
      + (CASE WHEN f_risk IS NULL THEN 0 ELSE 20 END) AS wsum,
    (CASE WHEN f_stop IS NULL THEN 0 ELSE 35 * f_stop END)
      + (CASE WHEN f_rr IS NULL THEN 0 ELSE 25 * f_rr END)
      + (CASE WHEN f_emo IS NULL THEN 0 ELSE 20 * f_emo END)
      + (CASE WHEN f_risk IS NULL THEN 0 ELSE 20 * f_risk END) AS wf,
    (CASE WHEN f_stop IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN f_rr IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN f_emo IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN f_risk IS NULL THEN 0 ELSE 1 END) AS napplic
  FROM crit
),
final AS (
  SELECT id,
    CASE WHEN napplic >= 2 AND wsum > 0 THEN ROUND(100.0 * wf / wsum)::int ELSE NULL END AS score
  FROM scored
)
UPDATE "Trade" t
SET "executionScore" = f.score,
    "executionGrade" = CASE
      WHEN f.score IS NULL THEN NULL
      WHEN f.score >= 80 THEN 'EXCELLENT'::"ExecutionGrade"
      WHEN f.score >= 60 THEN 'BON'::"ExecutionGrade"
      WHEN f.score >= 40 THEN 'MOYEN'::"ExecutionGrade"
      ELSE 'MAUVAIS'::"ExecutionGrade" END
FROM final f
WHERE t.id = f.id;
