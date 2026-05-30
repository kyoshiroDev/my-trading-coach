CREATE TABLE IF NOT EXISTS "EcoEvent" (
    "id"         TEXT NOT NULL,
    "date"       TEXT NOT NULL,
    "time"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "country"    TEXT NOT NULL,
    "currency"   TEXT NOT NULL,
    "impact"     TEXT NOT NULL,
    "actual"     DOUBLE PRECISION,
    "estimate"   DOUBLE PRECISION,
    "previous"   DOUBLE PRECISION,
    "isReleased" BOOLEAN NOT NULL DEFAULT false,
    "unit"       TEXT,
    "fetchedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcoEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EcoEvent_date_name_currency_key"
    ON "EcoEvent"("date", "name", "currency");

CREATE INDEX IF NOT EXISTS "EcoEvent_date_idx"
    ON "EcoEvent"("date");

CREATE INDEX IF NOT EXISTS "EcoEvent_date_isReleased_idx"
    ON "EcoEvent"("date", "isReleased");