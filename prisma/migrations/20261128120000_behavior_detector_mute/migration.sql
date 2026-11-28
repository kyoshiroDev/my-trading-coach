-- Détecteurs de comportement coupés par le trader (« Pas pour mon style », #671). Table nouvelle, additive.
CREATE TABLE "BehaviorDetectorMute" (
    "userId" TEXT NOT NULL,
    "detector" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BehaviorDetectorMute_pkey" PRIMARY KEY ("userId","detector")
);

ALTER TABLE "BehaviorDetectorMute" ADD CONSTRAINT "BehaviorDetectorMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
