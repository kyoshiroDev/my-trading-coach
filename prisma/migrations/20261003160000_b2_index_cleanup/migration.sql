-- SCA-B2-05 : index manquants des requêtes chaudes, suppression des index redondants.
-- Tables minuscules en prod au 2026-10-03 (Trade 987 lignes, User 22) : création et suppression
-- instantanées, pas besoin de CONCURRENTLY. Noms vérifiés présents / absents sur prod, beta, dev.
--
-- Redondants : chacun est déjà couvert par une contrainte unique sur les mêmes colonnes (ou dont
-- il est le préfixe : EcoAnalysisCache(date) ⊂ unique(date, assetsKey)) ; Trade(accountId) est le
-- préfixe du nouvel index Trade(accountId, tradedAt).

-- DropIndex
DROP INDEX "Trade_accountId_idx";

-- DropIndex
DROP INDEX "DailyRecap_userId_date_idx";

-- DropIndex
DROP INDEX "EcoCalendarCache_date_idx";

-- DropIndex
DROP INDEX "EcoAnalysisCache_date_idx";

-- DropIndex
DROP INDEX "MetricsSnapshot_date_idx";

-- DropIndex
DROP INDEX "UserDailyActivity_userId_date_idx";

-- CreateIndex
CREATE INDEX "User_isDemo_lastSeenAt_idx" ON "User"("isDemo", "lastSeenAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_accountId_tradedAt_idx" ON "Trade"("accountId", "tradedAt");

