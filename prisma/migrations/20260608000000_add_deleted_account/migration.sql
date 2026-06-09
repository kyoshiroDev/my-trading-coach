-- CreateTable
CREATE TABLE "DeletedAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "signedUpAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifetimeDays" INTEGER NOT NULL,
    "plan" "Plan" NOT NULL,
    "hadTraded" BOOLEAN NOT NULL,
    "tradesCount" INTEGER NOT NULL,
    "referredBy" TEXT,
    "deletedBy" TEXT NOT NULL,
    "reason" TEXT,
    "anonymizedAt" TIMESTAMP(3),

    CONSTRAINT "DeletedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedAccount_deletedAt_idx" ON "DeletedAccount"("deletedAt");

-- CreateIndex
CREATE INDEX "DeletedAccount_anonymizedAt_idx" ON "DeletedAccount"("anonymizedAt");
