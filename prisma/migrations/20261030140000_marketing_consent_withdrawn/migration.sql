-- Date du retrait du consentement marketing (#747) : marketingConsentAt est désormais gardé au retrait.
ALTER TABLE "User" ADD COLUMN "marketingConsentWithdrawnAt" TIMESTAMP(3);
