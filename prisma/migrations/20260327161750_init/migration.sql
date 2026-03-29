-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "EmotionState" AS ENUM ('CONFIDENT', 'STRESSED', 'REVENGE', 'FEAR', 'FOCUSED', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "SetupType" AS ENUM ('BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS');

-- CreateEnum
CREATE TYPE "TradingSession" AS ENUM ('LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "exit" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION,
    "riskReward" DOUBLE PRECISION,
    "emotion" "EmotionState" NOT NULL,
    "setup" "SetupType" NOT NULL,
    "session" "TradingSession" NOT NULL,
    "timeframe" TEXT NOT NULL,
    "notes" TEXT,
    "tags" TEXT[],
    "tradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyDebrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "insights" JSONB NOT NULL,
    "objectives" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyDebrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Trade_userId_tradedAt_idx" ON "Trade"("userId", "tradedAt");

-- CreateIndex
CREATE INDEX "Trade_userId_emotion_idx" ON "Trade"("userId", "emotion");

-- CreateIndex
CREATE INDEX "Trade_userId_setup_idx" ON "Trade"("userId", "setup");

-- CreateIndex
CREATE INDEX "WeeklyDebrief_userId_year_weekNumber_idx" ON "WeeklyDebrief"("userId", "year", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDebrief_userId_weekNumber_year_key" ON "WeeklyDebrief"("userId", "weekNumber", "year");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDebrief" ADD CONSTRAINT "WeeklyDebrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
