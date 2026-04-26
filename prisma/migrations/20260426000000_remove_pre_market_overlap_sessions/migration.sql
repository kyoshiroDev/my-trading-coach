-- Remove PRE_MARKET and OVERLAP from TradingSession enum
-- PostgreSQL does not support DROP VALUE on enums; recreate the type

-- Step 1: create new enum without the removed values
CREATE TYPE "TradingSession_new" AS ENUM ('LONDON', 'NEW_YORK', 'ASIAN');

-- Step 2: migrate existing rows (PRE_MARKET/OVERLAP rows become NULL — safe because zero clients)
ALTER TABLE "Trade"
  ALTER COLUMN "session" DROP DEFAULT,
  ALTER COLUMN "session" TYPE "TradingSession_new"
    USING (
      CASE "session"::text
        WHEN 'LONDON'     THEN 'LONDON'::"TradingSession_new"
        WHEN 'NEW_YORK'   THEN 'NEW_YORK'::"TradingSession_new"
        WHEN 'ASIAN'      THEN 'ASIAN'::"TradingSession_new"
        ELSE NULL
      END
    );

-- Step 3: drop old type and rename new one
DROP TYPE "TradingSession";
ALTER TYPE "TradingSession_new" RENAME TO "TradingSession";