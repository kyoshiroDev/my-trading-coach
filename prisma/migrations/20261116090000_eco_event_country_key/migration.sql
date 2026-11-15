-- C6 (#1046) : une annonce de la zone euro est identifiée aussi par son pays. Les PMI flash de France,
-- d'Allemagne et de la zone euro portent le même libellé et la même devise (EUR) : sous l'ancienne
-- clé (date, nom, devise), les trois fusionnaient en une ligne (pays de la 1re, chiffres de la dernière).
-- Sans perte : les lignes existantes sont uniques sur (date, nom, devise), donc aussi avec le pays.
-- Historique fusionné gardé tel quel (décision du 15/11).
DROP INDEX IF EXISTS "EcoEvent_date_name_currency_key";

CREATE UNIQUE INDEX "EcoEvent_date_name_currency_country_key" ON "EcoEvent"("date", "name", "currency", "country");
