# Modèles et index (notes par modèle)

> Contenu déplacé à l'identique depuis `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : prisma.md · `Trade.source` — provenance d'une ligne (PROMPT-217) · 2026-09-26 -->
> **Origine** : `prisma.md` · « `Trade.source` — provenance d'une ligne (PROMPT-217) » · 2026-09-26

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

<!-- Origine : prisma.md · Séances prop firm vues en direct (#373, 2026-10-05) · 2026-10-05 -->
> **Origine** : `prisma.md` · « Séances prop firm vues en direct (#373, 2026-10-05) » · 2026-10-05

## Séances prop firm vues en direct (#373, 2026-10-05)

- `AccountRiskDay` (unique `accountId + tradeDate`, journée de trading CME) : marge drawdown et
  perte journalière les PLUS BASSES de la séance avec leur heure, plancher au premier et au dernier
  relevé. Écrit par `PropRiskJournalService.recordReading` à chaque évaluation des alertes
  (Premium, app ouverte) : lecture puis upsert, le min se calcule côté code.
- `PropRiskEvent` (index `userId + tradeDate`, `accountId + tradeDate`) : chaque alerte prop firm
  (`kind` drawdown / daily_loss / consistency / objective / payout, `level` warning / critical /
  breached / reached) et chaque épisode de tilt (`kind = 'tilt'`, `level` = signal), avec ses
  chiffres en `data`. `kind` / `level` en TEXT, pas en enum : la liste grandit avec les alertes.
- Lus par `PropRiskContextService` (bloc « prop firm » des prompts IA, #374). Cascade à la
  suppression du compte. Seed démo (#367) : rejoués sur les trades du compte Apex connecté avec
  les vraies règles (`detectTilt`, `alertLevel`, plancher trailing EOD), cf.
  `admin/demo-data/prop-risk.ts`. Rien ne les affiche tels quels : ils nourrissent les textes
  fixes du compte démo (PREMIUM, aucun appel IA), récap du jour de tilt et `propNote` Apex du débrief.

<!-- Origine : prisma.md · E-mails de service (oct. 2026) · 2026-10-19 -->
> **Origine** : `prisma.md` · « E-mails de service (oct. 2026) » · 2026-10-19

## E-mails de service (oct. 2026)

`User.serviceEmailsOptOutAt` (migration `20261019120000_service_emails_opt_out`, additive, nullable) :
désinscription des e-mails d'aide à la prise en main (type `service`, sans consentement). Null =
reçus. Rempli par « Ne plus recevoir les e-mails d'aide au démarrage », la désinscription marketing ou la coupure du
consentement dans le profil. Détails : nestjs.md, « Suite d'e-mails d'onboarding ».

<!-- Origine : prisma.md · Index des requêtes chaudes (SCA-B2-05, 2026-10-03) · 2026-10-03 -->
> **Origine** : `prisma.md` · « Index des requêtes chaudes (SCA-B2-05, 2026-10-03) » · 2026-10-03

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

<!-- Origine : prisma.md · ProductEventDaily (2026-10-07) · 2026-10-07 -->
> **Origine** : `prisma.md` · « ProductEventDaily (2026-10-07) » · 2026-10-07

## ProductEventDaily (2026-10-07)

Entonnoir Premium : `@@unique([date, userId, event, place])` (upsert atomique +1), `@@index([date, event])`,
FK `User` `onDelete: Cascade` (suppression de compte = ses événements). Migration écrite à la main
(`20261007090000_product_event_daily`), même forme que `LandingVisitDaily`.

<!-- Origine : prisma.md · Rétention des données (SCA-B5-09, 2026-10-09) · 2026-10-09 -->
> **Origine** : `prisma.md` · « Rétention des données (SCA-B5-09, 2026-10-09) » · 2026-10-09

## Rétention des données (SCA-B5-09, 2026-10-09)

`modules/retention/retention.cron.ts` — le **1er du mois à 4 h 30 Paris** (après les dumps de 3 h),
worker cron seulement. `DELETE … WHERE id IN (SELECT id … LIMIT 5000)` en boucle, table par table
(une table en échec ne bloque pas les autres). Décisions de Greg du 2026-10-07 :

| Table | Colonne | Conservation |
|---|---|---|
| `MarketNews` | `publishedDate` | 30 jours |
| `StripeEvent` | `processedAt` | 90 jours (Stripe ne rejoue pas au-delà de 3 j) |
| `AiUsageLog` | `createdAt` | 13 mois (détail des coûts IA perdu au-delà) |
| `UserDailyActivity` | `date` | 24 mois |

- **`EmailSend` n'est JAMAIS purgée** : c'est l'anti-doublon des campagnes « une seule fois »
  (`EmailDispatchService.canSend`). La purger ferait renvoyer une campagne one-shot.
- Nouvelle table qui grossit sans fin → décider sa conservation et l'ajouter à `RETENTION_RULES`
  (liste figée : ses noms entrent tels quels dans le SQL). Validé sur vraie base :
  `retention.int-spec.ts`.
