-- CGU acceptées à l'inscription (#745, F2) : date et version enregistrées sur le compte.
-- Additive et compatible N-1 (colonnes nullables, l'ancien code ne les lit pas). Pas de rattrapage :
-- l'acceptation des comptes existants n'a jamais été enregistrée, null le dit.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;
