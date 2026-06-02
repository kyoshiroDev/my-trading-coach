-- AlterTable
ALTER TABLE "EcoEvent" ADD COLUMN "nameFr" TEXT;

-- CreateTable
CREATE TABLE "MarketNews" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT,
    "text" TEXT,
    "textFr" TEXT,
    "sentiment" TEXT,
    "image" TEXT,
    "site" TEXT,
    "publishedDate" TIMESTAMP(3) NOT NULL,
    "translated" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketNews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketNews_url_key" ON "MarketNews"("url");

-- CreateIndex
CREATE INDEX "MarketNews_symbol_publishedDate_idx" ON "MarketNews"("symbol", "publishedDate");

-- CreateIndex
CREATE INDEX "MarketNews_translated_idx" ON "MarketNews"("translated");
