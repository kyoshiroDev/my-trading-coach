-- CreateEnum
CREATE TYPE "MoodState" AS ENUM ('CONFIDENT', 'FOCUSED', 'NEUTRAL', 'TIRED', 'STRESSED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "TradeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "moodStart" "MoodState",
    "moodEnd" "MoodState",
    "totalPnl" DOUBLE PRECISION,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRecap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "tradesCount" INTEGER NOT NULL DEFAULT 0,
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dominantEmotion" TEXT,
    "aiOneLiner" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRecap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcoCalendarCache" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB NOT NULL,
    "aiAnalysis" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoCalendarCache_pkey" PRIMARY KEY ("id")
);

-- AlterTable Trade — ajouter la colonne sessionId
ALTER TABLE "Trade" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "TradeSession_userId_startedAt_idx" ON "TradeSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "TradeSession_userId_status_idx" ON "TradeSession"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecap_userId_date_key" ON "DailyRecap"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyRecap_userId_date_idx" ON "DailyRecap"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EcoCalendarCache_date_key" ON "EcoCalendarCache"("date");

-- CreateIndex
CREATE INDEX "EcoCalendarCache_date_idx" ON "EcoCalendarCache"("date");

-- CreateIndex
CREATE INDEX "Trade_sessionId_idx" ON "Trade"("sessionId");

-- AddForeignKey
ALTER TABLE "TradeSession" ADD CONSTRAINT "TradeSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecap" ADD CONSTRAINT "DailyRecap_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "TradeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
