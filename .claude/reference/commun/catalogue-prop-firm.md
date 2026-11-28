# Catalogue des règles prop firm (PROMPT-136)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Catalogue prop firm : synchro au démarrage (PROMPT-136, 2026-10-02) · 2026-10-02 -->
> **Origine** : `nestjs.md` · « Catalogue prop firm : synchro au démarrage (PROMPT-136, 2026-10-02) » · 2026-10-02

## Catalogue prop firm : synchro au démarrage (PROMPT-136, 2026-10-02)

`modules/prop-firms/` aligne les tables `PropFirm` / `PropFirmPlan` sur le catalogue JSON
(`PROP_FIRM_CATALOG_FILES` de `@mtc/shared`, embarqué dans `main.js` par webpack) à chaque
démarrage (`onApplicationBootstrap`). Relever les règles d'une firm = modifier son JSON, puis
redéployer : rien à lancer sur le VPS.

- `prop-firm-catalog.schema.ts` : calque **Zod** de `schema.json`, objets stricts. Les deux doivent
  rester alignés (le test `prop-firm-catalog.sync.spec.ts` parse le catalogue livré avec Zod ; la CI
  le valide avec ajv via `pnpm prop-firms:validate`). Sert aussi à relire les colonnes Json.
- `prop-firm-catalog.sync.ts` : logique pure (validation, unicité des ids, diff par `contentHash`).
  Catalogue invalide → exception avant toute écriture, **rien** n'est synchronisé.
- `prop-firm-catalog-sync.service.ts` : une transaction, verrou `pg_try_advisory_xact_lock(136001)`
  (non bloquant, compatible PgBouncer transaction) → sur les 8 workers du cluster, un seul écrit,
  les autres répondent `locked`. Redémarrage sans changement = `unchanged`, zéro écriture.
  Un échec est loggé (`Synchro du catalogue prop firm ignorée`) et **n'empêche jamais le boot**.
- Ajouter une firm : son JSON + une ligne dans `libs/shared/src/prop-firm-rules/catalog.ts`.
- **Veille des règles** (2026-10-07) : `pnpm prop-firms:watch` + workflow hebdomadaire « Veille règles prop firm » (issue `veille-prop-firm`). Toute mise à jour d'une firm se termine par `pnpm prop-firms:watch --update` (relevé `veille/sources.json`), voir le README du catalogue. `--update` réécrit le relevé de **toutes** les firms : quand on ne relit qu'une firm, ne garder dans le diff que ses URL, sinon les alertes en attente des autres disparaissent.
- **Perte journalière dans le résumé** (`GET /prop-firms`, 2026-10-18, #614) : `PropFirmPhaseSummary.dailyLossLimitStatus`
  (`none` = la firm n'en a pas · `known` · `unknown` = règle au montant non publié), calculé par
  `dailyLossLimitStatus` de `@mtc/shared`. `dailyLossLimit` seul ne suffit pas : `null` y vaut pour
  `none` comme pour `unknown`. Côté JSON, une DLL inconnue s'écrit en objet `amount: null` (pas `null`).
- **Indices de plan** (`GET /accounts/:id/plan-hint`, #612) : `AccountPlanHint` (`@mtc/shared`) =
  nom et hôte du sous-compte, propriétaire = login (démo perso) via `availableAccounts[].userId` ↔
  `externalUserId`, solde de départ = 1re `BrokerDailyClose` (`closingBalance − realizedPnl`).
  **Aucun appel broker** (clause 2.i NinjaTrader). `null` sans sous-compte choisi. La déduction
  (`guessPlan`, préfixes `PAAPEX` / `APEX` / `TAKEPROFIT`) est pure et vit dans `@mtc/shared`.
- **Comptes réels des statistiques (#828, #823)** : `REAL_USERS_WHERE` (Prisma) et `realUsersSql('u')` (SQL
  brut, interpolé dans `$queryRaw`), `common/stats/real-users.ts` : hors démo, hors comptes internes
  (`isInternal`) et hors ADMIN. Toute nouvelle statistique admin les utilise, jamais une copie du filtre.
  Jamais pour cibler des envois (`email-campaign.service.ts` et `auto-campaigns.cron.ts` gardent leur
  filtre, hors démo et ADMIN : les comptes de test reçoivent les e-mails ; `campaign-audience.spec.ts`).
- **Comptes internes (#823)** : `User.isInternal`, posé par l'interrupteur de la fiche admin
  (`PATCH /admin/users/:id { isInternal }`, `AdminGuard`), jamais par le domaine de l'adresse. Recopié
  dans `DeletedAccount.isInternal` par `archiveAndDelete`. Exclu : agrégats admin (via `REAL_USERS_WHERE`),
  chiffres des comptes supprimés (`adminStats`, `getDeletedAccounts` : la liste les garde, avec badge),
  compteur public de traders, compteurs de filleuls de l'admin (parrainage, ambassadeurs). Gardé :
  accès, e-mails, crons, commissions, compteur de places fondateur, vue du parrain sur ses filleuls,
  règle des 90 jours (`auth.service.ts`), `MetricsSnapshot` déjà enregistrés. États
  d'abonnement à compter : `subscriptionStateWhere(kind, now)` / `premiumAccessWhere(now)`
  (`common/stats/subscription-state-where.ts`), miroir de `subscriptionState` (@mtc/shared).
- **Mesure admin** (`GET /admin/prop-firms/plan-links`, `AdminPropFirmsController` + `PlanLinkStatsService`,
  calcul pur `plan-link-stats.ts`) : comptes **connectés** (sous-compte choisi, non archivés) reliés à un
  plan / connectés, filtre `REAL_USERS` (hors démo, internes et ADMIN) ; répartition des comptes sans plan par
  `planLinkChoice` ; firms « absentes » regroupées sans casse. Contrat `AdminPlanLinkStats` (`@mtc/shared`).
- **Comptes saisis avant le catalogue** (`prop-firm-plan-backfill.service.ts`) : après la synchro,
  le worker qui a tenu le verrou relie à leur plan les comptes EVAL / FUNDED sans plan, **seulement
  si un plan unique** colle (firm reconnue dans `broker` ou le libellé, taille, devise, objectif,
  drawdown, statique / trailing : `matchPlans` de `@mtc/shared`). Jamais un compte modifié depuis
  `PLAN_PICKER_RELEASED_AT` (il a pu être laissé sans plan exprès), jamais un user `isDemo`.
  En pratique c'est rare : les programmes d'une firm (EOD / intraday, DLL, payout) partagent
  objectif et drawdown (Lucid 50K = 9 plans). Les autres comptes reçoivent dans l'app une bannière
  « Relie ce compte à son plan » (masquable, `localStorage`) qui ouvre le formulaire sur la firm
  reconnue et la taille du compte.
- Import de JSON : `resolveJsonModule` est activé dans `tsconfig.base.json`, et les projets
  `composite` qui incluent `libs/shared` (API app + spec, spec de l'app) listent
  `libs/shared/src/prop-firm-rules/*.json` dans `include` (sinon TS6307). Le catalogue est exporté
  par l'index de `@mtc/shared` mais absent des bundles front tant qu'ils ne l'importent pas
  (vérifié : 0 occurrence dans app, admin, landing).

<!-- Origine : prisma.md · Catalogue des règles prop firm (PROMPT-136, 2026-10-02) · 2026-10-02 -->
> **Origine** : `prisma.md` · « Catalogue des règles prop firm (PROMPT-136, 2026-10-02) » · 2026-10-02

## Catalogue des règles prop firm (PROMPT-136, 2026-10-02)

Tables `PropFirm` et `PropFirmPlan` (migration `20261003120000_prop_firm_catalog`, purement additive ; 16 firms, 255 plans au 2026-10-05 : Lucid, Apex, Topstep, Tradeify, MyFundedFutures, TradeDay, Take Profit Trader, Phidias, Earn2Trade, Top One Futures, BluSky, Funded Futures Family, OneUp Trader, UProfit, Bulenox, Elite Trader Funding) :
**miroir** du catalogue JSON `libs/shared/src/prop-firm-rules/<firm>.json`, qui reste la source de
vérité. Ne jamais les modifier à la main ni par une migration de données : la synchro au démarrage
de l'API (`PropFirmCatalogSyncService`, cf. `nestjs.md`) écraserait la modification.

- **Ids = slugs du catalogue** (`apex`, `apex-eod-50k`), pas de cuid : stables par contrat
  (un id publié ne change jamais), ils servent de clé à la synchro et de valeur de FK.
- **Modèle hybride** : colonnes pour ce qui se filtre (`firmId`, `accountSize`, `currency`,
  `availability`, `needsReview`, `active`), règles détaillées en Json au format du catalogue
  (`phases`, `price`, `configuration`), relues avec `propFirmPhaseSchema` / `propFirmPriceSchema`
  (Zod, `modules/prop-firms/prop-firm-catalog.schema.ts`). Un champ ajouté au JSON = aucune migration.
  `configuration` (options du checkout) est relue par `planConfiguration`
  (`modules/prop-firms/prop-firm-plan-configuration.ts`, module pur) : stricte, elle lève, pour la liste
  et le détail (`getPlan` la renvoie depuis #1236) ; `planConfigurationOrNull` tolère et renvoie null
  sans lever pour la règle d'un compte (`DrawdownPlanRule.configuration`, métriques de chaque compte).
- `contentHash` (sha256 du contenu écrit) : la synchro n'écrit que les lignes dont l'empreinte change.
- `availability` : `public` | `invite_only` | `discontinued` (chaîne libre, aucune migration). Un plan
  plus vendu reste dans le JSON en `discontinued` : masqué dans les sélecteurs et sur la landing,
  toujours servi par `/prop-firms` pour les comptes déjà liés (X-Ultra, 2026-11-02).
  Côté API (#1242), `assertCatalogPlan` refuse en 400 un plan `discontinued` ou inactif à une nouvelle
  liaison (création, changement de plan). Un compte déjà relié le garde (jamais revérifié si le plan
  ne change pas). Exceptions voulues : la nouvelle tentative (`retryAccountData`) recopie le plan du
  compte perdu, et le backfill au démarrage peut relier un compte antérieur au 02/10 à un plan devenu
  `discontinued` (vendu à l'époque).
- **Plan retiré du JSON → `active = false`, jamais supprimé** (des comptes peuvent le référencer).
  `PropFirmPlan.firmId` en `onDelete: Restrict`.
- `verifiedAt` (date du relevé) est porté par `PropFirm`, pas par le plan.
- `TradingAccount.propFirmPlanId` : FK **nullable**, `onDelete: SetNull`, indexée. Plan relié →
  ses règles priment sur la saisie manuelle (`profitTarget`, `maxDrawdown`, `drawdownType`, qui
  restent le repli) : suivi du compte (`nestjs.md`, « Drawdown selon le plan prop firm relié »),
  séance, Mes comptes et cartes Courbe d'équité / Drawdown (`design.md`). Le seed démo relie ses
  3 comptes : `apex-eod-50k` (suiveur EOD), `tradeify-select-flex-50k` (funded, payout en jours),
  `elitetraderfunding-static-25k` (statique, 25K).
- **Gel du plancher au premier payout** (#696, #1247, #1241) : champ `max_drawdown.locks_on_first_payout`
  (`request` = dès la demande · `approval` = dès l'approbation · `payout` = non précisé par la firm),
  sur 121 phases funded / direct : Lucid Flex, Top One (Elite, Access, Access Static (aligné sur
  Access, sources muettes), X-Ultra, Instant, Ignite), Tradeify (Growth, Select, Lightning, Select
  Flex 300K), MyFundedFutures Pro, Topstep XFA, Funded Futures Family Premier+. Présent ⇒ drawdown
  suiveur et niveau figé connu (`locked_floor`, ou `locks_at − amount`) : vérifié par
  `payout-floor-lock.spec.ts`. Appliqué par `drawdownFloor(rule, peak, payoutFreezePeak)` : plancher
  = max(niveau figé, suiveur au moment du gel), jamais plus bas que le niveau figé. **Hors périmètre**
  (restent dans `basis_notes`) : TradeDay, et le **suivi sur le profit
  brut payouts compris** (TradeDay Quick Pay). Les suiveurs intraday sont approchés (trades clôturés,
  pas le plus haut latent).
  Topstep Static XFA (#1238) : MLL statique fixé à 0 $ au premier payout, gel non appliqué (drawdown
  statique, ni dans `payout-floor-lock.spec.ts` ni dans `drawdownFloor`), suivi dans #1310.
- `TradingAccount.planLinkChoice` (enum `PlanLinkChoice` : `LATER` · `PERSONAL` · `UNLISTED`) +
  `unlistedFirm` (migration `20261018140000_account_plan_link_choice`, additive, #612) : réponse à
  « Quel est ce compte ? » quand **aucun** plan n'est relié. Null = jamais demandé. Pas de valeur
  « LINKED » : un compte relié se lit sur `propFirmPlanId`. Le service remet la réponse à null dès
  qu'un plan est relié (`withPlanLink`), et efface `unlistedFirm` pour toute réponse autre que `UNLISTED`.
