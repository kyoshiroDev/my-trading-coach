-- PROMPT-217 : provenance d'un trade (saisie, CSV, synchro broker, historique broker).
--
-- Purement additive et non bloquante : la colonne a un DÉFAUT, donc les lignes existantes
-- sont valorisées sans réécriture de table ni verrou long (Postgres 11+ stocke le défaut
-- dans le catalogue). MANUAL pour l'existant : on ne sait pas rétroactivement d'où vient
-- une ligne, et c'est la valeur la moins mensongère — un trade importé garde de toute
-- façon son `importHash`, qui le distingue d'une saisie.

-- CreateEnum
CREATE TYPE "TradeSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'BROKER_SYNC', 'BROKER_HISTORY');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN "source" "TradeSource" NOT NULL DEFAULT 'MANUAL';
