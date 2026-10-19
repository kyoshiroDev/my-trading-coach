-- Détecteurs de comportement (#602) : référence personnelle du trader. Table nouvelle, additive.

-- CreateTable
CREATE TABLE "BehaviorBaseline" (
    "userId" TEXT NOT NULL,
    "sessionsUsed" INTEGER NOT NULL,
    "throughDay" DATE,
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehaviorBaseline_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "BehaviorBaseline" ADD CONSTRAINT "BehaviorBaseline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
