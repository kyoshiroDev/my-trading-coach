-- Essai Premium de 14 jours à l'inscription (#769). Additive et compatible N-1 (type et colonnes
-- nullables, l'ancien code ne les lit pas).

-- CreateEnum
CREATE TYPE "TrialSource" AS ENUM ('SIGNUP', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "trialSource" "TrialSource",
ADD COLUMN "signupTrialEndsAt" TIMESTAMP(3),
ADD COLUMN "trialEndHandledAt" TIMESTAMP(3),
ADD COLUMN "keptAccountId" TEXT;

-- Avant cette migration, seul le Premium offert par l'admin écrivait `trialEndsAt`.
UPDATE "User" SET "trialSource" = 'ADMIN' WHERE "trialEndsAt" IS NOT NULL;

-- Essais déjà terminés : rien à rattraper au premier passage du cron de fin d'essai.
UPDATE "User" SET "trialEndHandledAt" = now() WHERE "trialEndsAt" IS NOT NULL AND "trialEndsAt" <= now();
