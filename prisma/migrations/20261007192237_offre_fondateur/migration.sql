-- Offre fondateur (200 places) et codes partenaires (#525). Migration ADDITIVE : aucune
-- table existante modifiée. Registres : FounderSeat (numéro jamais réattribué), PartnerCode +
-- PartnerRedemption (conditions figées), CheckoutReservation (anti-survente, 30 min),
-- FounderOfferConfig (ligne unique, offre FERMÉE par défaut).

-- CreateEnum
CREATE TYPE "FounderSeatStatus" AS ENUM ('ACTIVE', 'LOST', 'REFUNDED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PartnerRedemptionStatus" AS ENUM ('ACTIVE', 'LOST', 'RELEASED');

-- CreateEnum
CREATE TYPE "CheckoutReservationKind" AS ENUM ('FOUNDER', 'PARTNER');

-- CreateTable
CREATE TABLE "FounderOfferConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "open" BOOLEAN NOT NULL DEFAULT false,
    "endsAt" TIMESTAMP(3),
    "notifiedMilestones" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderOfferConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FounderSeat" (
    "number" INTEGER NOT NULL,
    "userId" TEXT,
    "status" "FounderSeatStatus" NOT NULL DEFAULT 'ACTIVE',
    "interval" TEXT NOT NULL,
    "cta" TEXT,
    "stripeSubscriptionId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FounderSeat_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "PartnerCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceMonthlyEur" INTEGER NOT NULL,
    "priceAnnualEur" INTEGER NOT NULL,
    "durationMonths" INTEGER,
    "maxRedemptions" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stripeCouponMonthlyId" TEXT NOT NULL,
    "stripeCouponAnnualId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerRedemption" (
    "id" TEXT NOT NULL,
    "partnerCodeId" TEXT NOT NULL,
    "userId" TEXT,
    "priceMonthlyEur" INTEGER NOT NULL,
    "priceAnnualEur" INTEGER NOT NULL,
    "durationMonths" INTEGER,
    "stripeCouponId" TEXT NOT NULL,
    "status" "PartnerRedemptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "cta" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutReservation" (
    "id" TEXT NOT NULL,
    "kind" "CheckoutReservationKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerCodeId" TEXT,
    "interval" TEXT NOT NULL,
    "cta" TEXT,
    "stripeSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderSeat_userId_key" ON "FounderSeat"("userId");

-- CreateIndex
CREATE INDEX "FounderSeat_status_idx" ON "FounderSeat"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCode_code_key" ON "PartnerCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRedemption_userId_key" ON "PartnerRedemption"("userId");

-- CreateIndex
CREATE INDEX "PartnerRedemption_partnerCodeId_status_idx" ON "PartnerRedemption"("partnerCodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutReservation_stripeSessionId_key" ON "CheckoutReservation"("stripeSessionId");

-- CreateIndex
CREATE INDEX "CheckoutReservation_kind_expiresAt_idx" ON "CheckoutReservation"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutReservation_partnerCodeId_expiresAt_idx" ON "CheckoutReservation"("partnerCodeId", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutReservation_userId_idx" ON "CheckoutReservation"("userId");

-- AddForeignKey
ALTER TABLE "FounderSeat" ADD CONSTRAINT "FounderSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRedemption" ADD CONSTRAINT "PartnerRedemption_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRedemption" ADD CONSTRAINT "PartnerRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutReservation" ADD CONSTRAINT "CheckoutReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutReservation" ADD CONSTRAINT "CheckoutReservation_partnerCodeId_fkey" FOREIGN KEY ("partnerCodeId") REFERENCES "PartnerCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une seule ligne de configuration, et des numéros de fondateur toujours >= 1.
ALTER TABLE "FounderOfferConfig" ADD CONSTRAINT "FounderOfferConfig_singleton" CHECK ("id" = 1);
ALTER TABLE "FounderSeat" ADD CONSTRAINT "FounderSeat_number_positive" CHECK ("number" >= 1);

-- Ligne de configuration créée FERMÉE : rien n'est visible tant que l'admin n'ouvre pas l'offre.
INSERT INTO "FounderOfferConfig" ("id", "open", "updatedAt") VALUES (1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
