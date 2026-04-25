# Agent Prisma — Schéma & Migrations

## Commandes

```bash
pnpm dlx prisma migrate dev --name <description>   # nouvelle migration (dev)
pnpm dlx prisma migrate deploy                      # appliquer en prod (via entrypoint.sh)
pnpm dlx prisma generate                            # regénérer le client
pnpm dlx prisma studio                              # GUI d'exploration
pnpm dlx prisma validate                            # valider le schéma
```

## PgBouncer — règle critique

En production, `DATABASE_URL` pointe vers PgBouncer (port 6432, transaction mode).
**PgBouncer en transaction mode est incompatible avec les migrations DDL.**

→ Les migrations utilisent `DATABASE_DIRECT_URL` (Postgres direct, port 5432) :
```sh
# entrypoint.sh — automatique au démarrage du container
DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" prisma migrate deploy
```

→ `DATABASE_URL` prod doit avoir `?pgbouncer=true&connection_limit=1`
→ `DATABASE_DIRECT_URL` prod pointe vers `mtc_postgres:5432` directement

---

## Schéma actuel

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["queryCompiler", "driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String          @id @default(cuid())
  email       String          @unique
  password    String          // Argon2 hash — jamais exposer
  name        String?
  plan        Plan            @default(FREE)
  trialEndsAt DateTime?
  trialUsed   Boolean         @default(false)
  stripeCustomerId String?    @unique
  trades      Trade[]
  debriefs    WeeklyDebrief[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model Trade {
  id         String         @id @default(cuid())
  userId     String
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset      String
  side       TradeSide
  entry      Float
  exit       Float?
  stopLoss   Float?
  takeProfit Float?
  pnl        Float?
  riskReward Float?
  emotion    EmotionState
  setup      SetupType
  session    TradingSession
  timeframe  String
  notes      String?
  tags       String[]       @default([])
  tradedAt   DateTime       @default(now())
  createdAt  DateTime       @default(now())

  @@index([userId, tradedAt])
  @@index([userId, emotion])
  @@index([userId, setup])
  @@index([userId, session])
}

model WeeklyDebrief {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  weekNumber  Int
  year        Int
  startDate   DateTime
  endDate     DateTime
  aiSummary   String
  insights    Json
  objectives  Json
  stats       Json
  generatedAt DateTime @default(now())

  @@unique([userId, weekNumber, year])
  @@index([userId, year, weekNumber])
}

enum Plan           { FREE PREMIUM }
enum TradeSide      { LONG SHORT }
enum EmotionState   { CONFIDENT STRESSED REVENGE FEAR FOCUSED NEUTRAL }
enum SetupType      { BREAKOUT PULLBACK RANGE REVERSAL SCALPING NEWS }
enum TradingSession { LONDON NEW_YORK ASIAN PRE_MARKET OVERLAP }
```

---

## Règles de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Models | PascalCase singulier | `User`, `Trade` |
| Fields | camelCase | `tradedAt`, `userId` |
| Enums | PascalCase | `TradeSide` |
| Enum values | UPPER_SNAKE | `LONG`, `PRE_MARKET` |
| Index | `@@index([field1, field2])` | voir schéma |
| Unique | `@@unique([field1, field2])` | voir schéma |

---

## Requêtes types

### Pagination curseur (O(1) — OBLIGATOIRE)

```typescript
const trades = await prisma.trade.findMany({
  take: limit,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  where: { userId, ...filters },
  orderBy: { tradedAt: 'desc' },
});
const nextCursor = trades.length === limit ? trades[trades.length - 1].id : null;
```

### Limite 50 trades/mois FREE

```typescript
const startOfMonth = new Date();
startOfMonth.setDate(1);
startOfMonth.setHours(0, 0, 0, 0);

const count = await prisma.trade.count({
  where: { userId, createdAt: { gte: startOfMonth } }
});

if (user.plan === 'FREE' && count >= 50) {
  throw new HttpException('Limite de 50 trades/mois atteinte. Passe à Premium.', 403);
}
```

### Stats analytics summary

```typescript
const trades = await prisma.trade.findMany({
  where: { userId },
  select: { pnl: true, tradedAt: true, emotion: true, setup: true }
});
```

---

## Migrations — bonnes pratiques

- Toujours nommer clairement : `add_stripe_customer_id`, `add_trade_tags`
- Jamais de migration destructive sans backup préalable
- Tester la migration en dev avant d'appliquer en prod
- En prod : `prisma migrate deploy` (pas `migrate dev`)
- Après modification schéma : toujours `prisma generate`

---

## Ne jamais exposer

- `password` dans les réponses API → toujours `select: { password: false }` ou spread sans password
- `stripeCustomerId` dans les réponses publiques
