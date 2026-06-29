-- Cache quotidien du coût RÉEL facturé par Anthropic (Cost API). Source autoritative.
CREATE TABLE "AnthropicCostDaily" (
    "date" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnthropicCostDaily_pkey" PRIMARY KEY ("date", "model")
);
