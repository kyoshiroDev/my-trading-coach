-- Source d'acquisition (UTM) à l'inscription : colonnes nullable, purement additives,
-- sans défaut ni backfill (les comptes existants restent « non renseigné »).
ALTER TABLE "User" ADD COLUMN "acquisitionSource" TEXT;
ALTER TABLE "User" ADD COLUMN "acquisitionMedium" TEXT;
ALTER TABLE "User" ADD COLUMN "acquisitionCampaign" TEXT;
