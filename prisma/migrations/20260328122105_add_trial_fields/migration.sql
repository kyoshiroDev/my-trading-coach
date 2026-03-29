-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialUsed" BOOLEAN NOT NULL DEFAULT false;
