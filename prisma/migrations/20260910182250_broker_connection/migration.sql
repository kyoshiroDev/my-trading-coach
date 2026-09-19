-- PROMPT-207 : connexion API broker (Tradovate OAuth, lecture seule) par TradingAccount.
--
-- Une ligne par (compte, broker) : un user Apex + Lucid fait deux connexions distinctes,
-- jamais au niveau User. Les tokens sont stockés chiffrés (AES-256-GCM côté API).
-- Cascade explicite sur User (archiveAndDelete RGPD) et sur TradingAccount (suppression
-- d'un compte = révocation locale de sa connexion). Migration purement additive.

-- CreateEnum
CREATE TYPE "BrokerProvider" AS ENUM ('TRADOVATE');

-- CreateEnum
CREATE TYPE "BrokerConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT');

-- CreateTable
CREATE TABLE "BrokerConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "BrokerProvider" NOT NULL,
    "status" "BrokerConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "externalUserId" TEXT,
    "externalAccountId" TEXT,
    "externalAccountName" TEXT,
    "externalEnv" TEXT,
    "availableAccounts" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "tradesImported" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerConnection_userId_idx" ON "BrokerConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrokerConnection_accountId_provider_key" ON "BrokerConnection"("accountId", "provider");

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
