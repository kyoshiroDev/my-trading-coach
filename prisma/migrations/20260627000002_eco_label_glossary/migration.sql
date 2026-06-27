-- CreateTable : glossaire global des libellés éco (1 traduction à vie par libellé EN)
CREATE TABLE "EcoLabelTranslation" (
    "nameEn" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoLabelTranslation_pkey" PRIMARY KEY ("nameEn")
);

-- Backfill : démarrer le glossaire plein depuis les libellés déjà traduits (zéro re-traduction).
INSERT INTO "EcoLabelTranslation" ("nameEn", "nameFr")
SELECT DISTINCT ON ("name") "name", "nameFr"
FROM "EcoEvent"
WHERE "nameFr" IS NOT NULL
ORDER BY "name"
ON CONFLICT ("nameEn") DO NOTHING;
