-- Ajustements manuels négatifs des comptes funded : payouts confirmés (plus « probables »).
UPDATE "BrokerPayout" SET "confidence" = 'certain' WHERE "confidence" = 'probable';
