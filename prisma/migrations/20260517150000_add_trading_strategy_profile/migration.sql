-- AlterTable
ALTER TABLE "User" ADD COLUMN "tradingStyle" TEXT,
ADD COLUMN "tradingStrategy" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "tradingSessions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "tradesPerDayMin" INTEGER,
ADD COLUMN "tradesPerDayMax" INTEGER,
ADD COLUMN "strategyDescription" TEXT;
