-- DropForeignKey (recréée ensuite avec userId nullable)
ALTER TABLE "AiUsageLog" DROP CONSTRAINT "AiUsageLog_userId_fkey";

-- AlterTable : userId nullable + colonne model (vrai modèle appelé)
ALTER TABLE "AiUsageLog" ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN     "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';

-- CreateIndex
CREATE INDEX "AiUsageLog_model_idx" ON "AiUsageLog"("model");

-- AddForeignKey (userId nullable, cascade conservé)
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
