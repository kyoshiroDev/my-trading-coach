-- Fiche de parsing d'un broker, deduite une fois puis reutilisee pour tous les utilisateurs.
-- Ajout purement additif : nouvelle table, aucune colonne touchee ailleurs.
--
-- La table ne contient AUCUNE donnee de trading : uniquement des index de colonnes et des
-- regles de format. "headerSample" garde l'en-tete brut pour diagnostiquer une fiche qui ne
-- matche plus apres une mise a jour du broker.
CREATE TABLE "BrokerCsvMapping" (
    "id" TEXT NOT NULL,
    "headerHash" TEXT NOT NULL,
    "brokerName" TEXT NOT NULL,
    "headerSample" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL,
    "pnlConfidence" DOUBLE PRECISION NOT NULL,
    "validatedById" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerCsvMapping_pkey" PRIMARY KEY ("id")
);

-- Cle de reconnaissance : une seule fiche par en-tete.
CREATE UNIQUE INDEX "BrokerCsvMapping_headerHash_key" ON "BrokerCsvMapping"("headerHash");
CREATE INDEX "BrokerCsvMapping_enabled_idx" ON "BrokerCsvMapping"("enabled");
CREATE INDEX "BrokerCsvMapping_validatedById_idx" ON "BrokerCsvMapping"("validatedById");

-- ON DELETE RESTRICT : une fiche porte les imports de tous les utilisateurs de ce broker.
-- Supprimer l'admin qui l'a validee ne doit pas la faire disparaitre en cascade.
ALTER TABLE "BrokerCsvMapping"
  ADD CONSTRAINT "BrokerCsvMapping_validatedById_fkey"
  FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
