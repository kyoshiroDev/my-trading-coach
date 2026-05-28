-- AlterTable
ALTER TABLE "User" ADD COLUMN "pinnedEcoEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];