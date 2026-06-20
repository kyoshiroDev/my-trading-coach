-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('EVALUATION', 'FUNDED', 'PERSONAL', 'DEMO');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PASSED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DrawdownType" AS ENUM ('STATIC', 'TRAILING');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "TradeSession" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "TradingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "broker" TEXT,
    "type" "AccountType" NOT NULL DEFAULT 'PERSONAL',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountSize" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startingBalance" DOUBLE PRECISION,
    "profitTarget" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "drawdownType" "DrawdownType" NOT NULL DEFAULT 'STATIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradingAccount_userId_status_idx" ON "TradingAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "Trade_accountId_idx" ON "Trade"("accountId");

-- CreateIndex
CREATE INDEX "TradeSession_accountId_idx" ON "TradeSession"("accountId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSession" ADD CONSTRAINT "TradeSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
