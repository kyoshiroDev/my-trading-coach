---
name: prisma
description: "Schéma Prisma et migrations : conventions, index, compte démo. À lire avant de modifier prisma/schema.prisma ou d'écrire une migration."
---

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
# entrypoint.sh — au démarrage du container si RUN_MIGRATIONS≠false (défaut),
# ou seul via `docker compose run --rm <service> migrate` (déploiement sans coupure, SCA-B8-02)
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
  pnl             Float?          // P&L BRUT (frais dans `commission`) ; net = netPnl() à la lecture (PROMPT-213)
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

> **Suppression de compte et FK** : toute relation vers `User` doit porter une règle
> `onDelete` EXPLICITE. Sans elle, Postgres applique `RESTRICT`, et
> `UsersService.archiveAndDelete` (trace RGPD + `user.delete` dans UNE transaction)
> échoue sur violation de contrainte — l'utilisateur ne peut plus partir, et la trace
> est annulée avec le reste. C'est arrivé sur `ReferralCommission.ambassadorId` et
> `ReferralReward.parrainId`, seules des 11 relations vers `User` à ne rien déclarer
> (migration `20260830000000_referral_cascade_on_user_delete`). Vérifier la règle
> RÉELLEMENT appliquée en base, pas seulement le schéma :
> `SELECT rc.delete_rule FROM information_schema.referential_constraints rc …`.
> Un double Prisma ne connaît aucune FK : seul un `int-spec` sur vraie base peut le
> prouver (`delete-me-referral.int-spec.ts`).

> **Setups** : setups définis par l'utilisateur (modèle `Setup` : `title`, `color`, `description`, `sortOrder`, `archived`). 6 défauts seedés au signup et pour la démo (Breakout `#10b981`, Pullback `#3b82f6`, Range `#f59e0b`, Reversal `#ef4444`, Scalping `#8b5cf6`, News `#60a5fa`). L'ancienne énumération de setups a été migrée en table (remap par titre, zéro régression). `Trade.setupId` (FK, `onDelete: NoAction`) → `Setup` ; la suppression d'un setup encore référencé par des trades est bloquée par `SetupsService` (+ backstop FK).
>
> **« Sans setup »** (PROMPT-213) : `Trade.setupId` restant NOT NULL, les trades importés sans setup choisi (synchro broker, CSV, `setupId` périmé) sont rangés dans un setup `Sans setup` (`#6b7280`, sortOrder 999) créé à la volée par `SetupsService.getImportSetupId` — pas de migration. Les trades importés AVANT ce correctif restent sur le premier setup du user (souvent « Breakout ») : ne pas les déplacer sans accord. Exception faite avec accord (2026-09-15, beta) : les 279 trades synchronisés de Val (comptes TDFY + test) passés sur « Sans setup », les 34 saisis à la main restés sur Breakout ; sauvegarde id → ancien setup conservée pour rollback.
>
> **Devise (PROMPT-214)** : propriété DU COMPTE — `TradingAccount.currency` (TEXT, défaut `USD`, valeurs autorisées = `ACCOUNT_CURRENCIES` de `@mtc/shared` : USD, USDT, EUR, validées par l'API). Aucune conversion nulle part. **`User.currency` et `User.currencyRate` sont OBSOLÈTES** : plus lus ni écrits par le code (API, app, admin), colonnes conservées pour un retour arrière ; à supprimer dans une **migration séparée** une fois le code déployé en prod (5 users prod avaient une préférence EUR, prévenus avant ce déploiement). Normalisation des devises de compte (vide / hors liste → USD, en transaction avec log des ids) : 0 ligne sur beta le 2026-09-15.
>
> **P&L** : `Trade.pnl` = BRUT, `Trade.commission` = frais (positifs). Aucune colonne « net » : le net se calcule (`netPnl` de `@mtc/shared`). Vérifié le 2026-09-14 (lecture seule) : aucun trade manuel avec frais depuis le 20/08, les anciens trades à frais sont bruts ou indéterminables → pas de migration.

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

### Trades FREE — illimités (PROMPT-169)

Le quota mensuel de 30 trades FREE a été **supprimé** : plus de `checkMonthlyLimit`,
`countThisMonth`, ni code `FREE_LIMIT_REACHED`. Tous les plans loggent sans limite.

### Stats analytics summary

```typescript
const trades = await prisma.trade.findMany({
  where: { userId },
  select: { pnl: true, tradedAt: true, emotion: true, setup: true }
});
```

---

## `Trade.source` — provenance d'une ligne (PROMPT-217)

`enum TradeSource { MANUAL · CSV_IMPORT · BROKER_SYNC · BROKER_HISTORY }`, colonne
`source @default(MANUAL)`. Posée au SEUL point de création (`TradesService.create`, via
`opts.source`) ; `importTrades(userId, dtos, source)` la propage au lot. Les trois appelants
la passent explicitement : import CSV → `CSV_IMPORT` (défaut du paramètre), synchro Tradovate
→ `BROKER_SYNC`, import historique → `BROKER_HISTORY`.

À quoi ça sert : un écart de frais ou de P&L ne se diagnostique pas pareil selon qu'il vient
d'une saisie, d'un fichier de l'utilisateur, de la séance broker ou d'un rapport mensuel.
⚠️ Elle ne remplace pas `importHash` : celui-ci reste la clé de dédup et distingue déjà
« importé » de « saisi à la main ». `source` dit **lequel** des imports.

Migration `20260926120000_trade_source` : purement additive, colonne avec DÉFAUT donc aucune
réécriture de table ni verrou long. L'existant devient `MANUAL` — on ne sait pas
rétroactivement d'où vient une ligne, et c'est la valeur la moins mensongère.

---

## `BrokerCsvMapping` — registre des brokers (2026-09-28)

Fiche de parsing d'un export CSV, déduite une fois par un modèle puis réutilisée pour **tous**
les utilisateurs, gratuits compris. Remplace l'écriture d'un parseur TypeScript par broker :
les fiches vivant en base, ajouter un broker ne demande ni build ni déploiement.

- `headerHash` (unique) : empreinte de l'en-tête normalisé, clé de reconnaissance. Voulue
  **exacte** — une colonne ajoutée par le broker change la signature, la fiche ne matche plus et
  l'import redevient « inconnu ». Mieux vaut ne pas reconnaître que lire chaque colonne à côté.
- `mappingJson` : la fiche au format `CsvMapping` (`trades/csv-mapping.ts`).
- `pnlConfidence` : part des lignes dont le signe du P&L confirmait le sens à la validation.
  Trace de la confiance accordée, pour pouvoir réexaminer une fiche plus tard.
- `validatedById` en `onDelete: Restrict` : une fiche porte les imports de tous les
  utilisateurs de ce broker, supprimer l'admin ne doit pas la faire disparaître en cascade.
- `enabled` : on désactive, on ne supprime pas — on garde la trace d'une fiche qui s'est
  avérée mauvaise.

**Aucune donnée de trading dans cette table** : uniquement des index de colonnes et des règles
de format. L'échantillon qui a servi à déduire la fiche n'est pas conservé ; seul l'en-tête brut
l'est (`headerSample`), pour diagnostiquer une fiche qui ne matche plus.

## Catalogue des règles prop firm (PROMPT-136, 2026-10-02)

Tables `PropFirm` et `PropFirmPlan` (migration `20261003120000_prop_firm_catalog`, purement additive ; 16 firms, 255 plans au 2026-10-04 : Lucid, Apex, Topstep, Tradeify, MyFundedFutures, TradeDay, Take Profit Trader, Phidias, Earn2Trade, Top One Futures, BluSky, Funded Futures Family, OneUp Trader, UProfit, Bulenox, Elite Trader Funding) :
**miroir** du catalogue JSON `libs/shared/src/prop-firm-rules/<firm>.json`, qui reste la source de
vérité. Ne jamais les modifier à la main ni par une migration de données : la synchro au démarrage
de l'API (`PropFirmCatalogSyncService`, cf. `nestjs.md`) écraserait la modification.

- **Ids = slugs du catalogue** (`apex`, `apex-eod-50k`), pas de cuid : stables par contrat
  (un id publié ne change jamais), ils servent de clé à la synchro et de valeur de FK.
- **Modèle hybride** : colonnes pour ce qui se filtre (`firmId`, `accountSize`, `currency`,
  `availability`, `needsReview`, `active`), règles détaillées en Json au format du catalogue
  (`phases`, `price`, `configuration`), relues avec `propFirmPhaseSchema` / `propFirmPriceSchema`
  (Zod, `modules/prop-firms/prop-firm-catalog.schema.ts`). Un champ ajouté au JSON = aucune migration.
- `contentHash` (sha256 du contenu écrit) : la synchro n'écrit que les lignes dont l'empreinte change.
- **Plan retiré du JSON → `active = false`, jamais supprimé** (des comptes peuvent le référencer).
  `PropFirmPlan.firmId` en `onDelete: Restrict`.
- `verifiedAt` (date du relevé) est porté par `PropFirm`, pas par le plan.
- `TradingAccount.propFirmPlanId` : FK **nullable**, `onDelete: SetNull`, indexée. Aucune UI ni
  logique ne la lit encore : les règles saisies par l'utilisateur sur `TradingAccount`
  (`profitTarget`, `maxDrawdown`, `drawdownType`) restent la référence. Le seed démo ne la remplit
  pas (ses règles Apex 50k datent de l'ancienne gamme : drawdown 2 500 contre 2 000 au catalogue).

## Migrations — bonnes pratiques

- Toujours nommer clairement : `add_stripe_customer_id`, `add_trade_tags`
- Jamais de migration destructive sans backup préalable
- Tester la migration en dev avant d'appliquer en prod
- En prod : `prisma migrate deploy` (pas `migrate dev`)
- Après modification schéma : toujours `prisma generate`

### Migrations compatibles N-1 (déploiement sans coupure, SCA-B8-02, 2026-10-03)

Pendant une bascule blue/green, **l'ancienne version de l'API tourne encore sur le schéma déjà
migré** (la migration passe avant le démarrage de la nouvelle couleur, et l'ancienne draine
~30 s ensuite). Toute migration doit donc être **lisible et écrivable par la version précédente
du code** :
- **Ajouter** : colonne nullable ou avec `DEFAULT`, nouvelle table, nouvel index (`CONCURRENTLY`
  si la table est grosse) → OK en un déploiement.
- **Supprimer / renommer** une colonne ou une table → **en deux déploiements** : (1) le code
  arrête de la lire et de l'écrire (la colonne reste) ; (2) au déploiement suivant, la migration
  la supprime. Renommer = ajouter la nouvelle + backfill + double écriture, puis supprimer
  l'ancienne plus tard.
- **Rendre NOT NULL / ajouter une contrainte** sur une colonne que l'ancien code peut laisser
  vide → seulement après un déploiement où le code la remplit toujours (+ backfill).
- Changer le type d'une colonne lue par l'ancien code → nouvelle colonne, même méthode que le renommage.

---

## Ne jamais exposer

- `password` dans les réponses API → toujours `select: { password: false }` ou spread sans password
- `stripeCustomerId` dans les réponses publiques

> **Connexions broker (PROMPT-207)** : `BrokerConnection` = une connexion API par
> `(accountId, provider)` (`@@unique`), jamais au niveau `User`. Enum `BrokerProvider`
> (`TRADOVATE`, à étendre : Binance, Bybit) et `BrokerConnectionStatus` (`CONNECTED`,
> `NEEDS_RECONNECT`). Colonnes `accessTokenEnc` / `refreshTokenEnc` **chiffrées**
> (`token-cipher.util`), à ne JAMAIS sélectionner dans une réponse API. `externalAccountId` +
> `externalEnv` (`live`/`demo`) = compte broker choisi ; `availableAccounts` (Json) = comptes
> vus au consentement. Cascade explicite sur `User` ET `TradingAccount` (migration
> `20260910182250_broker_connection`). Le seed démo en crée une (placeholder de token, jamais
> déchiffré : le compte démo ne peut pas synchroniser).
>
> `externalUserId` = l'utilisateur Tradovate **authentifié** (`/user/list`), jamais
> `account.userId` (= le propriétaire du compte, donc la **firme** sur un compte prop firm : deux
> traders Apex étrangers portaient `699523`). C'est la clé du verrou de renouvellement et de la
> propagation aux connexions sœurs — une valeur partagée entre traders sérialise tout le monde.
>
> `BrokerPayout` + `BrokerConnection.payoutsCheckedThrough` (migration
> `20261004110000_broker_payout`, additive, cascade sur le compte, `@@unique([accountId,
> transactionId])`) = payouts détectés dans l'historique de trésorerie du broker.
>
> `TradingAccount.lastPayoutAt` (migration `20261004090000_trading_account_last_payout`, `DATE`
> nullable, additive) = séance du dernier payout reçu, saisie par l'utilisateur : début du cycle de
> payout (cf. `nestjs.md`, « Progression objectif / payout »). Le DTO reçoit `AAAA-MM-JJ`,
> converti en Date dans `AccountsService` (Prisma refuse une date seule pour un DateTime).
>
> `BrokerDailyClose` (migration `20261003230000_broker_daily_close`, table nouvelle, cascade sur
> `TradingAccount`, `@@unique([accountId, tradeDate])`, `tradeDate` en `@db.Date` = date de SÉANCE)
> = soldes de clôture officiels lus chez le broker (cf. `nestjs.md`, « Clôtures officielles »).
> Le seed démo en crée pour le compte connecté vitrine, tirés de ses trades.
>
> `TradingAccount.platform` (migration `20261003220000_trading_account_platform`, TEXT nullable,
> additive) = plateforme de trading saisie (`rithmic`, `tradovate`…), pour les règles qui en
> dépendent (verrouillage Apex). Ignorée quand le compte a une connexion Tradovate.
>
> `brokerCashBalance`/`brokerCashBalanceAt`, `brokerNetLiq`, `brokerOpenPnl`, `brokerEquityAt`,
> `brokerOpenPositions` (migration `20261003200000_broker_live_balance`, purement additive) = solde,
> equity et positions ouvertes lus chez le broker (cf. `nestjs.md`, « Solde et equity lus chez le
> broker »). Le seed démo les remplit sur la connexion vitrine, cohérents avec ses trades.
>
> `historyImportedAt` (migration `20260926230000_broker_history_imported_at`, nullable, ajout
> additif) = date du premier import RÉUSSI de tout l'historique du compte, remonté jusqu'à sa
> création. Vide = le passé n'a jamais été remonté entièrement : le **cron de fond** le rattrape
> (≤ 2 par passage), jamais le bouton « Synchroniser » — 24 fenêtres coûtent 11 s d'appels et
> personne ne doit attendre ça devant son écran. Ne jamais le poser après un import d'un seul mois
> ni quand une fenêtre a échoué : le trou ne serait plus jamais comblé. Cf. `nestjs.md`,
> profondeur de l'historique.

> **Acquisition UTM** (migration `20261002000000_user_acquisition_utm`, oct. 2026) : `User.acquisitionSource`,
> `acquisitionMedium`, `acquisitionCampaign` (TEXT nullable, sans défaut ni backfill). Remplis à
> l'inscription depuis les `utm_*` du lien (landing → `/register` → `POST /auth/register`), normalisés
> trim + minuscules par `RegisterDto`. **`null` = aucun UTM** : ne jamais écrire « direct » en base,
> la catégorie « direct / non renseigné » est faite à l'agrégation (`GET /admin/acquisition`).

> **Visites landing sans cookie** (migration `20261002160000_landing_visit_daily`, oct. 2026) :
> `LandingVisitDaily` = compteurs agrégés `(date Paris, path, source, medium, campaign)` → `pageviews`,
> `visits` (medium + campagne ajoutés par `20261003100000_landing_visit_medium_campaign`, `''` = absent).
> **Aucune donnée personnelle** (ni IP, ni identifiant, ni lien User) : c'est la condition de
> l'exemption CNIL, ne jamais y ajouter de colonne identifiante. `source = ''` = direct (pas NULL,
> sinon l'unique ne déduplique pas). Écriture uniquement par `INSERT … ON CONFLICT` (PublicService).

## Index des requêtes chaudes (SCA-B2-05, 2026-10-03)

Migration `20261003160000_b2_index_cleanup` :
- **Ajoutés** : `Trade(accountId, tradedAt)` (stats filtrées par compte et période, B2-01 à 03),
  `User(isDemo, lastSeenAt)` (utilisateurs actifs hors démo), `User(createdAt)` (inscriptions).
- **Supprimés car redondants** : `Trade(accountId)` (préfixe du nouvel index),
  `DailyRecap(userId, date)`, `UserDailyActivity(userId, date)`, `EcoCalendarCache(date)`,
  `MetricsSnapshot(date)` (identiques à leur contrainte unique), `EcoAnalysisCache(date)`
  (préfixe de l'unique `(date, assetsKey)`).
- Règle : **pas de `@@index` qui duplique un `@@unique` / `@unique`** (Postgres crée déjà un index
  pour l'unicité) ni le préfixe d'un autre index. Sur une table > 1 M lignes, créer l'index à la
  main en `CREATE INDEX CONCURRENTLY` (hors transaction), puis migration vide qui le constate.
- Avant un `DROP INDEX` en migration : vérifier sa présence sous ce nom exact sur prod, beta et dev
  (un index absent fait échouer la migration au déploiement).
