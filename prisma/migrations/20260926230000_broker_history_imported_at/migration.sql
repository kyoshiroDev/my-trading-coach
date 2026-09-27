-- Date du premier import complet de l'historique broker (remonté jusqu'à la création du compte).
-- Colonne nullable sans valeur par défaut : ajout purement additif, aucune réécriture de table.
-- Les connexions existantes restent à NULL, donc leur prochaine synchro remonte tout leur passé.
ALTER TABLE "BrokerConnection" ADD COLUMN "historyImportedAt" TIMESTAMP(3);
