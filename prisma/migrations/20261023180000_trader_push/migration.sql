-- Notifications push des traders (#666) : un enum et deux tables nouvelles, purement additifs et
-- compatibles N-1 (l'ancien code ne les lit pas). Cascade à la suppression du User.

-- CreateEnum
CREATE TYPE "PushAlertType" AS ENUM ('PROP_RULES', 'BEHAVIOR', 'RECAP', 'CONNECTION');

-- CreateTable
CREATE TABLE "UserPushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "UserPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraderPushPreference" (
    "userId" TEXT NOT NULL,
    "mutedTypes" "PushAlertType"[] DEFAULT ARRAY['RECAP']::"PushAlertType"[],
    "quietStart" INTEGER,
    "quietEnd" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraderPushPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPushDevice_endpoint_key" ON "UserPushDevice"("endpoint");

-- CreateIndex
CREATE INDEX "UserPushDevice_userId_idx" ON "UserPushDevice"("userId");

-- AddForeignKey
ALTER TABLE "UserPushDevice" ADD CONSTRAINT "UserPushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraderPushPreference" ADD CONSTRAINT "TraderPushPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
