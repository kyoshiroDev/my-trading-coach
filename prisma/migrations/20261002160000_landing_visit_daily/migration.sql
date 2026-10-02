-- Mesure d'audience landing sans cookie : compteurs agrégés jour × page × source (aucune donnée personnelle).
-- CreateTable
CREATE TABLE "LandingVisitDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LandingVisitDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingVisitDaily_date_path_source_key" ON "LandingVisitDaily"("date", "path", "source");

