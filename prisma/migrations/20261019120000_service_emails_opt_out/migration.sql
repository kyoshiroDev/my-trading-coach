-- E-mails de service de la suite d'onboarding : désinscription propre. Additive et compatible N-1
-- (colonne nullable, l'ancien code ne la lit pas).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "serviceEmailsOptOutAt" TIMESTAMP(3);
