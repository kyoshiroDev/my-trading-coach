CREATE TABLE "EmailCampaignLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "sentBy" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailCampaignLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailCampaignLog_type_sentAt_idx" ON "EmailCampaignLog"("type", "sentAt");
