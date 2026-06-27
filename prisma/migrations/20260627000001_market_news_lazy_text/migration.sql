-- AlterTable : le texte de l'article est désormais traduit paresseusement (à la 1re ouverture)
ALTER TABLE "MarketNews" ADD COLUMN     "textTranslated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill : les articles déjà traduits (ancien batch) ne doivent pas être re-traduits à l'ouverture.
UPDATE "MarketNews" SET "textTranslated" = true WHERE "textFr" IS NOT NULL;
