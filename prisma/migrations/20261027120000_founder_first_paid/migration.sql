-- Réservation fondateur pendant le Premium offert (#769, B1) : date du premier paiement réel.
-- Additive et compatible N-1 (colonne nullable, l'ancien code ne la lit pas).

-- AlterTable
ALTER TABLE "FounderSeat" ADD COLUMN "firstPaidAt" TIMESTAMP(3);

-- Places existantes : toutes payées à la prise de place (aucune réservation avant #769).
UPDATE "FounderSeat" SET "firstPaidAt" = "takenAt";
