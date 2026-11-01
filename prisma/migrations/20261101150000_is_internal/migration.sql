-- #823 : comptes internes (tests de l'équipe) exclus des statistiques admin.
-- Valeur par défaut constante : aucune réécriture de table (PostgreSQL >= 11).
ALTER TABLE "User" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeletedAccount" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;
