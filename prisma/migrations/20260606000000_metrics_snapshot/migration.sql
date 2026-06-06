-- CreateTable
CREATE TABLE "MetricsSnapshot" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "mrr" INTEGER NOT NULL,
    "arr" INTEGER NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "freeUsers" INTEGER NOT NULL,
    "starterUsers" INTEGER NOT NULL,
    "premiumUsers" INTEGER NOT NULL,
    "trials" INTEGER NOT NULL,
    "newThisDay" INTEGER NOT NULL,
    "activeUsers" INTEGER NOT NULL,
    "betaTesters" INTEGER NOT NULL,
    "ambassadors" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricsSnapshot_date_key" ON "MetricsSnapshot"("date");

-- CreateIndex
CREATE INDEX "MetricsSnapshot_date_idx" ON "MetricsSnapshot"("date");
