-- Tirage au sort mensuel (PROMPT-tirage-mensuel, #1150) : interrupteurs, tirages, lots gagnés,
-- et TrialSource.GIVEAWAY. Additive (nouvelles tables, nouvelle valeur d'enum), compatible N-1 :
-- l'ancienne version ne lit ni n'écrit ces tables et ne rencontre jamais GIVEAWAY.
-- CreateEnum
CREATE TYPE "GiveawayPool" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "GiveawayDisplayConsent" AS ENUM ('NONE', 'PSEUDO', 'PRENOM_INITIALE');

-- CreateEnum
CREATE TYPE "GiveawayModeration" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REFUSE');

-- CreateEnum
CREATE TYPE "GiveawayActivation" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "GiveawayPublication" AS ENUM ('NONE', 'PUBLISHED', 'FAILED');

-- AlterEnum
ALTER TYPE "TrialSource" ADD VALUE 'GIVEAWAY';

-- CreateTable
CREATE TABLE "GiveawaySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "freeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "premiumEnabled" BOOLEAN NOT NULL DEFAULT false,
    "freeEnabledAt" TIMESTAMP(3),
    "premiumEnabledAt" TIMESTAMP(3),
    "freeAnnouncedAt" TIMESTAMP(3),
    "premiumAnnouncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawaySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayDraw" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "pool" "GiveawayPool" NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "winnerId" TEXT,
    "eligibleHash" TEXT NOT NULL,
    "drawnIndex" INTEGER,

    CONSTRAINT "GiveawayDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayWin" (
    "id" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "userId" TEXT,
    "pool" "GiveawayPool" NOT NULL,
    "prizeMonths" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "activationStatus" "GiveawayActivation" NOT NULL DEFAULT 'PENDING',
    "activationError" TEXT,
    "creditCents" INTEGER,
    "stripeBalanceTxId" TEXT,
    "displayConsent" "GiveawayDisplayConsent" NOT NULL DEFAULT 'NONE',
    "displayPseudo" TEXT,
    "message" TEXT,
    "moderation" "GiveawayModeration" NOT NULL DEFAULT 'EN_ATTENTE',
    "moderatedAt" TIMESTAMP(3),
    "instagramConsent" BOOLEAN NOT NULL DEFAULT false,
    "instagramHandle" TEXT,
    "publicationStatus" "GiveawayPublication" NOT NULL DEFAULT 'NONE',
    "publishedUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "endingNoticeSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawayWin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiveawayDraw_winnerId_idx" ON "GiveawayDraw"("winnerId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayDraw_period_pool_key" ON "GiveawayDraw"("period", "pool");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayWin_drawId_key" ON "GiveawayWin"("drawId");

-- CreateIndex
CREATE INDEX "GiveawayWin_userId_createdAt_idx" ON "GiveawayWin"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GiveawayDraw" ADD CONSTRAINT "GiveawayDraw_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayWin" ADD CONSTRAINT "GiveawayWin_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "GiveawayDraw"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayWin" ADD CONSTRAINT "GiveawayWin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
