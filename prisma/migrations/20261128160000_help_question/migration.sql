-- Chatbot de support (#493) : questions posées, sans IP ni donnée de trading. Table nouvelle, additive.
-- CreateTable
CREATE TABLE "HelpQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "question" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kbId" TEXT,
    "page" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpQuestion_createdAt_idx" ON "HelpQuestion"("createdAt");

-- CreateIndex
CREATE INDEX "HelpQuestion_userId_createdAt_idx" ON "HelpQuestion"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HelpQuestion" ADD CONSTRAINT "HelpQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

