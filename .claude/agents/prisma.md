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
  role        Role            @default(USER)
  trialEndsAt DateTime?
  trialUsed   Boolean         @default(false)
  stripeCustomerId         String?   @unique
  stripeSubscriptionId     String?
  stripePriceId            String?
  stripeCurrentPeriodEnd   DateTime?
  stripeInterval           String?   // 'month' | 'year'
  trades           Trade[]
  debriefs         WeeklyDebrief[]
  aiUsageLogs      AiUsageLog[]
  tradingSessions  TradingSession[]   // ← V2
  dailyRecaps      DailyRecap[]       // ← V2
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model Trade {
  id              String          @id @default(cuid())
  userId          String
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  asset           String
  side            TradeSide
  entry           Float
  exit            Float?
  exitPrice       Float?          // alias de exit pour clarté — V2
  stopLoss        Float?
  takeProfit      Float?
  pnl             Float?
  riskReward      Float?
  executionScore  Int?                             // note d'exécution CALCULÉE 0-100 (PROMPT-161), null si non évaluable
  executionGrade  ExecutionGrade?                  // EXCELLENT/BON/MOYEN/MAUVAIS dérivé du score
  executionMethod ExecutionMethod?                 // barème ayant produit la note (STOP_BASED / BEHAVIORAL), null si non notée (PROMPT-168)
  emotion         EmotionState?                    // override OPTIONNEL (PROMPT-163) — null = non renseignée
  setupId         String                           // FK → Setup (setup défini par l'user)
  setup           Setup           @relation(fields: [setupId], references: [id], onDelete: NoAction)
  session         TradingSessionLabel
  sessionId       String?                          // ← V2 — lien vers TradingSession
  tradingSession  TradingSession? @relation(fields: [sessionId], references: [id])
  timeframe       String
  notes           String?
  tags            String[]       @default([])
  tradedAt        DateTime       @default(now())
  createdAt       DateTime       @default(now())

  @@index([userId, tradedAt])
  @@index([userId, emotion])
  @@index([userId, setupId])
  @@index([userId, session])
  @@index([userId, sessionId])
}

// ── Modèles V2 Session Mode ──────────────────────────────────────────────────

model TradingSession {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  startedAt   DateTime      @default(now())
  endedAt     DateTime?
  moodStart   MoodState?
  moodEnd     MoodState?
  totalPnl    Float?
  totalTrades Int           @default(0)
  winRate     Float?
  status      SessionStatus @default(ACTIVE)
  notes       String?
  trades      Trade[]
  createdAt   DateTime      @default(now())

  @@index([userId, startedAt])
  @@index([userId, status])
}

model DailyRecap {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date            DateTime // date du jour (minuit UTC)
  tradesCount     Int      @default(0)
  pnl             Float    @default(0)
  winRate         Float    @default(0)
  dominantEmotion String?
  aiOneLiner      String?  // phrase IA — Premium uniquement
  generatedAt     DateTime @default(now())

  @@unique([userId, date])
  @@index([userId, date])
}

model EcoCalendarCache {
  id          String   @id @default(cuid())
  date        DateTime
  rawData     Json
  aiAnalysis  Json
  generatedAt DateTime @default(now())

  @@unique([date])
  @@index([date])
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

model AiUsageLog {
  id           String   @id @default(cuid())
  userId       String
  feature      String   // 'insights' | 'chat' | 'debrief' | 'csv_import'
  inputTokens  Int
  outputTokens Int
  costUsd      Float
  createdAt    DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([createdAt])
  @@index([feature])
}

enum Plan                { FREE PREMIUM }
enum Role                { USER ADMIN BETA_TESTER }
enum TradeSide           { LONG SHORT }
enum EmotionState        { CONFIDENT STRESSED REVENGE FEAR FOCUSED NEUTRAL }
enum TradingSessionLabel { LONDON NEW_YORK ASIAN PRE_MARKET OVERLAP }  // label session trade
enum MoodState           { CONFIDENT FOCUSED NEUTRAL TIRED STRESSED }   // ← V2
enum SessionStatus       { ACTIVE CLOSED }                              // ← V2
```

> **Setups** : setups définis par l'utilisateur (modèle `Setup` : `title`, `color`, `description`, `sortOrder`, `archived`). 6 défauts seedés au signup et pour la démo (Breakout `#10b981`, Pullback `#3b82f6`, Range `#f59e0b`, Reversal `#ef4444`, Scalping `#8b5cf6`, News `#60a5fa`). L'ancienne énumération de setups a été migrée en table (remap par titre, zéro régression). `Trade.setupId` (FK, `onDelete: NoAction`) → `Setup` ; la suppression d'un setup encore référencé par des trades est bloquée par `SetupsService` (+ backstop FK).

> **Émotion (PROMPT-163)** : `Trade.emotion` est **nullable** — un **override optionnel** (surtout REVENGE/FEAR dans l'instant). L'émotion de base vient de la journée : `TradeSession.moodStart` (`MoodState`, inclut `TIRED`). **Émotion effective = `trade.emotion ?? trade.tradeSession?.moodStart ?? null`** — helper unique `common/utils/effective-emotion.util.ts` (`effectiveEmotion`, `isRiskyEmotion` = STRESSED/REVENGE/FEAR/TIRED, `isHealthyEmotion` = CONFIDENT/FOCUSED/NEUTRAL). `null` = non renseignée → **exclue** des agrégations (dominante, analytics, IA, note d'exécution renormalisée), **jamais** de faux NEUTRAL. Toute requête qui a besoin de l'émotion effective doit `select`/`include` `tradeSession: { select: { moodStart: true } }`. L'API `GET /trades` expose `effectiveEmotion` par trade ; le front l'affiche (« — » si null). Les deux enums restent distincts (`EmotionState` trade vs `MoodState` journée).

> **Note d'exécution (PROMPT-161)** : `executionScore` (0-100) + `executionGrade`
> (`ExecutionGrade` = EXCELLENT/BON/MOYEN/MAUVAIS) **calculés** (déterministe, **zéro IA**,
> **indépendants du P&L**), **jamais saisis**. Helper pur `computeExecutionGrade(trade, account)`
> (`common/utils/execution-grade.util.ts`) : 4 critères pondérés (stop respecté 35 · R:R 25 ·
> émotion effective saine 20 · risque ≤ max 20) ; critère non évaluable ignoré + renormalisation ;
> < 2 critères applicables → `null` (« Non évalué »). Recalculé à la **création / édition / import**
> (donnée stable persistée, jamais recalculée à la lecture) ; **backfill SQL** dans la migration.
> Seuils par défaut exposés : `RR_MIN=1.5`, `RISK_MAX_PCT=1`, `RISK_SOFT_PCT=2`, poids `{35,25,20,20}`.

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

### Limite 30 trades/mois FREE

```typescript
const startOfMonth = new Date();
startOfMonth.setDate(1);
startOfMonth.setHours(0, 0, 0, 0);

const count = await prisma.trade.count({
  where: { userId, createdAt: { gte: startOfMonth } }
});

if (user.plan === 'FREE' && count >= 30) {
  throw new HttpException('Limite de 30 trades/mois atteinte. Passe à Premium.', 403);
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
