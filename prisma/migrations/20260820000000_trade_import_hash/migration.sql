-- PROMPT-186 #1 : déduplication d'import portée par la BASE.
--
-- La dédup était purement applicative (lire tous les trades, comparer, insérer). Deux
-- requêtes concurrentes — un simple double-clic sur « Importer » — lisaient le même état
-- vide puis inséraient toutes les deux : 40 trades au lieu de 20, P&L et frais doublés,
-- sans aucun signal. Une contrainte d'unicité est la seule protection qui tienne quel que
-- soit le timing.
--
-- `importHash` n'est renseigné que pour les trades issus d'un import. Les trades saisis à
-- la main restent à NULL : en Postgres, plusieurs NULL ne violent PAS un index unique, donc
-- la saisie manuelle n'est absolument pas contrainte (deux scalps identiques à la même
-- seconde restent créables).
--
-- Les trades importés AVANT cette migration gardent `importHash` NULL : ils ne sont pas
-- rétro-hashés (reproduire en SQL le formatage ISO/nombre du calcul applicatif serait
-- fragile). Leur déduplication reste assurée par la comparaison applicative, conservée
-- exprès en amont de l'insertion.

ALTER TABLE "Trade" ADD COLUMN "importHash" TEXT;

CREATE UNIQUE INDEX "Trade_userId_importHash_key" ON "Trade"("userId", "importHash");