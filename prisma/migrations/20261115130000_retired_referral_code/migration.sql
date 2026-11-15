-- A5 (#1013) : codes de parrainage retirés (changés ou révoqués), jamais redonnés à un autre compte.
-- Additive (nouvelle table), compatible N-1 : l'ancienne version ne la lit ni ne l'écrit.
CREATE TABLE "RetiredReferralCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetiredReferralCode_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "RetiredReferralCode_userId_idx" ON "RetiredReferralCode"("userId");
