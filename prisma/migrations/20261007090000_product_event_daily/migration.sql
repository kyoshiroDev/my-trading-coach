-- Entonnoir Premium : événements produit des inscrits, agrégés jour × user × événement × écran.
-- CreateTable
CREATE TABLE "ProductEventDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductEventDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEventDaily_date_userId_event_place_key" ON "ProductEventDaily"("date", "userId", "event", "place");

-- CreateIndex
CREATE INDEX "ProductEventDaily_date_event_idx" ON "ProductEventDaily"("date", "event");

-- AddForeignKey
ALTER TABLE "ProductEventDaily" ADD CONSTRAINT "ProductEventDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
