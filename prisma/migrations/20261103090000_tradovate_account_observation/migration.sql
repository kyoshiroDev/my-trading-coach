-- #684 phase 2 : journal d'observation Tradovate, une ligne par connexion et par jour.
-- Additive : nouvelle table et nouvel enum, aucune table existante modifiée, compatible avec l'API N-1.

-- CreateEnum
CREATE TYPE "TradovateObservationOutcome" AS ENUM ('OK', 'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED', 'PENALIZED', 'NOT_FOUND', 'UNAVAILABLE', 'TOKEN_REFUSED', 'TOKEN_DEFERRED', 'ERROR');

-- CreateTable
CREATE TABLE "TradovateAccountObservation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "outcome" "TradovateObservationOutcome" NOT NULL,
    "httpStatus" INTEGER,
    "listed" BOOLEAN,
    "active" BOOLEAN,
    "closed" BOOLEAN,
    "restricted" BOOLEAN,
    "accountStatus" "AccountStatus" NOT NULL,
    "syncPaused" BOOLEAN NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradovateAccountObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradovateAccountObservation_day_idx" ON "TradovateAccountObservation"("day");

-- CreateIndex
CREATE UNIQUE INDEX "TradovateAccountObservation_connectionId_day_key" ON "TradovateAccountObservation"("connectionId", "day");

-- AddForeignKey
ALTER TABLE "TradovateAccountObservation" ADD CONSTRAINT "TradovateAccountObservation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BrokerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
