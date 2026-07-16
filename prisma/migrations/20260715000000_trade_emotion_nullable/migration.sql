-- PROMPT-163 — Émotion de trade optionnelle (override).
-- L'émotion de base vient de la journée (TradeSession.moodStart) ; Trade.emotion devient
-- un override optionnel. On rend simplement la colonne nullable — les valeurs existantes
-- (trades saisis à la main) sont conservées telles quelles (pas de « déneutralisation »
-- rétroactive : les anciens imports NEUTRAL sont indistinguables et restent NEUTRAL).
-- L'index @@index([userId, emotion]) reste valide sur une colonne nullable.

-- AlterTable
ALTER TABLE "Trade" ALTER COLUMN "emotion" DROP NOT NULL;
