# Statistiques calculées en SQL

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Statistiques calculées en SQL (SCA-B2-01, 2026-10-02) · 2026-10-02 -->
> **Origine** : `nestjs.md` · « Statistiques calculées en SQL (SCA-B2-01, 2026-10-02) » · 2026-10-02

## Statistiques calculées en SQL (SCA-B2-01, 2026-10-02)

`analytics/analytics.sql.ts` : `groupTrades` (agrégats par setup / émotion / actif / session /
heure / jour-heure / date de Paris), `summaryTotals` (sommes, série en cours en fenêtres SQL),
`cumulativeByTrade`, `closedTradeNets` (net + heure de clôture + compte par trade). **Drawdown max :
plus en SQL** — `summary.maxDrawdown` (montant positif, lu par le débrief), `/equity-curve/trades`, les
totaux de session et le seed démo passent tous par `@mtc/shared` (après chaque trade clôturé, trades
du même instant = une étape). Résumé et `/equity-curve/trades` : `worstAccountDrawdown`, UNE SÉRIE
PAR COMPTE (trades sans compte = un groupe, égalité → plus petit id), le pire gardé, et
`maxDrawdownAccountId` (PROMPT-drawdown-max-par-compte). Jamais une série mélangée : le gain d'un
compte n'efface pas la perte d'un autre. Le débrief retire `maxDrawdownAccountId` avant le prompt IA
et `WeeklyDebrief.stats` (format inchangé). `/equity-curve/trades` seul renvoie aussi
`maxDrawdownAccountCount` (groupes ayant un trade clôturé, trades sans compte = un groupe) : l'app
masque la courbe de drawdown dès 2 séries (#940) ; jamais dans le résumé.
**Stats du débrief = semaine du débrief** (#934) : `getSummary(userId, undefined, startDate, endDate)`
avec les bornes de `getWeekInfo` (lundi 00:00 → dimanche 23:59:59.999, heure du serveur = Paris),
les mêmes que les trades du débrief. Elles partent dans le prompt IA, `WeeklyDebrief.stats` et
l'e-mail « débrief prêt » : jamais `getSummary(userId)` seul (tout l'historique). Format des stats :
`debriefStats()` (`debrief/debrief-stats.ts`, sans `maxDrawdownAccountId`).
**Résumé = calcul pur unique** : `computeSummary(prisma, filtre)` dans `analytics/analytics-summary.ts`
(avec `bestByWinRate`, `winRatePercent`), appelé par `AnalyticsService` (avec cache) et par les
scripts ; les requêtes `analytics.sql.ts` prennent un `SqlClient` (`$queryRaw` seul), donc un
`PrismaClient` nu de script convient. Ne jamais importer un service Nest dans un script.
**Anciens débriefs (#943)** : `scripts/recompute-debrief-stats.ts` (logique testée dans
`debrief/debrief-stats-recompute.ts`) recalcule `WeeklyDebrief.stats` sur les `startDate`/`endDate`
enregistrés, sans IA (texte inchangé), hors démo. Simulation par défaut (bilan sans identifiant),
`--apply` exige `--backup <nouveau fichier>` (ligne `{ id, stats }` écrite avant chaque mise à
jour), `--user <id>` pour un essai, `--restore <fichier> [--apply]` pour revenir en arrière. Lancé
dans le worker API (procédure en tête du script : copie dans `/tmp`, `-e NODE_PATH=/app/node_modules`,
sauvegarde dans `/tmp` puis copiée sur le VPS). Exclusion des comptes échoués / archivés selon leur
statut actuel. **Semaine sans plus aucun trade clôturé** (décision du 11/11) : débrief NON touché si
la semaine en avait à la génération (`tradesAtGeneration`, somme des `insights.accounts[].stats.totalTrades`)
ou si l'ancien format n'a pas de sections ; compté dans `ignores`. Semaine déjà vide à la génération :
recalculée (0 trade = vraie valeur).
**Drawdown d'une séance** (`session-totals.ts`, #935) : `worstAccountDrawdown` sur ses trades, pire
compte gardé. Une ancienne séance sans compte rattache toujours les trades du jour de tous les
comptes (totaux inchangés, voulu), mais son drawdown n'est jamais une série mélangée. Lire
`accountId` avec les trades de la séance (`sessionTrades`, `scripts/close-sessions.ts`).
**Plus aucun calcul ne charge tous les trades en mémoire.**
- Règles reproduites à l'identique : net = `round(pnl − |commission|, 2)` (comme `netPnl`),
  gagnant si net > 0 ; R:R compté s'il est renseigné et non nul ; heure / jour dans le **fuseau du
  processus** (`processTimeZone()`, comme les anciens `getHours()` ; TZ=Europe/Paris en prod) ;
  dates d'activité à Paris. Les sélections (meilleure session : strictement supérieur, égalités
  au premier apparu → `bestByWinRate`) restent en JS.
- Valeurs en **paramètres liés** (`Prisma.sql`) ; les seules expressions brutes viennent de la
  liste blanche `GroupKey`. Jamais de `Prisma.raw` sur une entrée.
- Gain mesuré (compte 50 000 trades) : CPU Node par appel divisé par 100 à 1 500 (courbe
  journalière 12,6 s → 0,42 s).
- **Toute modification d'un calcul** : `analytics-sql-equivalence.int-spec.ts` (5 000 trades
  piégeux, étalon figé `src/test/analytics-legacy.service.ts`, écart ≤ 0,01) et
  `analytics.service.scenarios.int-spec.ts` (scénarios métier sur vrai Postgres) doivent passer.
  Un changement VOLONTAIRE de règle → modifier aussi l'étalon, et le dire dans la PR.

### Métriques des comptes en SQL (SCA-B2-03, 2026-10-02)

`AccountsService.list` → `ruleAggregatesSql` (accounts/account-rules.ts) : agrégats de tous les
comptes en une requête, plus de chargement des trades. `computeRuleMetrics(compte, trades)` reste
(= `aggregateRuleTrades` étalon JS + `ruleMetricsFromAgg`). ⚠️ Règle propre aux comptes,
conservée : solde / objectif / drawdown / meilleur-pire jour lisent `pnl − commission`
**signée, sans arrondi** (une commission négative augmente le solde), alors que le win rate et
tout le reste de l'app lisent `netPnl` (`round(pnl − |commission|, 2)`). Depuis #947, `TradesService`
stocke toujours |commission| : plus de frais négatifs écrits. Meilleur / pire jour = **journée CME**
(`tradingDay`, 17:00 Chicago), comme la consistency et la perte journalière (décision du 11/11 ; avant,
date UTC). Équivalence : `account-rules-sql.int-spec.ts`.

### Solde et equity lus chez le broker (2026-10-03)

`TradovateBalanceService` (`integrations/tradovate/tradovate-balance.service.ts`) remplit les colonnes
`BrokerConnection.broker*` : solde réalisé officiel, equity (`netLiq`), latent, positions ouvertes.
- **Solde réalisé en temps réel** : le WebSocket souscrit aussi `cashBalance` (`LIVE_ENTITY_TYPES`,
  avec `order` / `orderVersion` pour les SL / TP, cf. « SL / TP des positions ») ;
  chaque variation → `recordCashBalance` → événement front `tradovate:balance`, **sans** synchro
  REST. L'état initial (réponse du `user/syncrequest`, id `SYNC_REQUEST_ID`) donne solde + positions.
- **Equity + latent** : `POST /cashBalance/getcashbalancesnapshot`, seule lecture en POST, via
  `TradovateApiClient.postRead` (liste blanche `READ_ONLY_POST_PATHS`, toute autre route levée
  avant le réseau). ⚠️ La doc NinjaTrader qualifie de **anti-pattern** l'interrogation répétée de
  cette route : appelée **sur événement uniquement** — fin de chaque synchro (trade poussé, cron,
  rattrapage) et `GET /integrations/tradovate/accounts/:accountId/balance` (ouverture de « Mes
  comptes », bouton « Actualiser »), bridé à 20 s par compte (`BALANCE_REFRESH_MIN_MS`). Jamais de
  `setInterval`. Best-effort : un échec ne casse ni la synchro ni la page.
- **Métriques** (`AccountsService.ruleMetricsFromAgg(…, broker)`) : le solde broker fait foi
  (`currentBalance`, `realizedPnl`, objectif) et la marge de drawdown se calcule sur l'**equity**
  (latent compris tant qu'une position est ouverte ; sans position, equity = solde). Trailing
  intraday : un nouveau plus haut d'equity relève le seuil. **Sans aucun trade, `realizedPnl` = 0**
  (objectif et progression aussi) : l'écart broker ↔ solde de départ d'un compte neuf (frais,
  centimes) reste dans le solde et la marge, jamais compté comme perte de trading. Écart solde broker ↔ solde MTC
  > max(2 000 $, 25 % de la taille) = référentiel incompatible (`brokerReferenceMismatch`, ex.
  funded saisi à 0 $) → calcul MTC + latent, `broker.referenceMismatch` affiché à l'utilisateur.
- Le plus haut de clôture des règles EOD vient des **clôtures officielles** (section suivante).

### Clôtures officielles (rapport `Account Balance History`, 2026-10-03)

`TradovateClosingsService` (`integrations/tradovate/tradovate-closings.service.ts`) remplit
`BrokerDailyClose` (une ligne par compte et par journée de trading : `closingBalance` = « Total
Amount », `realizedPnl`). Même jeton OAuth que l'import, aucune permission en plus.
- **Cadence** : dans `TradovateSyncService.sync` quand `history: true` (cron horaire, retour
  après absence, bouton « Synchroniser »), best-effort. Incrémental : reprise à la dernière séance
  stockée (relue), sinon depuis la création du compte ; fenêtres de 60 jours.
- **Séance en cours jamais stockée** (`tradeDate < tradingDay(now)`) : son « Total Amount » n'est
  une clôture qu'après la fermeture.
- **Format réel** (mesuré) : `Account ID, Account Name, Trade Date (AAAA-MM-JJ), Total Amount
  ("50,000.00"), Total Realized PNL` ; une ligne seulement les jours où le solde a bougé. Colonnes
  lues par leur nom ; montants par `parseUsNumber(…, { strict: true })` (`NaN` si illisible ; ex-`parseReportAmount`, fusionné #782). Les
  parseurs d'import utilisent la même fonction en mode tolérant (unité en suffixe acceptée).
- **Métriques** : trailing EOD → plus haut = max des clôtures officielles si elles couvrent la
  séance précédente (`previousSession`, week-end sauté) ET que le solde broker est dans le
  référentiel du compte ; sinon le plus prudent des deux (trades / officiel). `rule.peakSource`
  (`broker` | `trades`), `rule.peakBalance`, `rule.officialThrough` affichés sous la marge.

### Progression objectif / payout (2026-10-04)

`metrics.progress` (`accounts/account-progress.ts`, fonctions pures) pour un compte relié à un plan :
- **Évaluation** (`profit_target`) : profit = solde courant (broker si connu) − solde de départ ;
  consistency `applies_to: profit_target` → objectif effectif = max(objectif, meilleur jour ÷ X %) ;
  `min_trading_days` = séances tradées.
- **Funded / direct** (`payout`) : cycle = séances après `TradingAccount.lastPayoutAt` (saisi par
  l'utilisateur, sinon depuis le début — affiché) ; `min_days` + `min_daily_profit` (jours
  gagnants), `min_cycle_profit` ou palier de `min_cycle_profit_schedule` (1er payout, sinon le
  suivant), consistency `applies_to: payout` (plancher meilleur jour ÷ X %, palier idem),
  `safety_net_balance` décalé sur le solde de départ du compte ; + `min_amount` quand
  `safety_net_basis = after_payout` (solde à garder après le retrait, #1228). Absent ou `to_request` :
  le net seul. Sans net, `min_amount` n'est pas appliqué au profit du cycle (base retirable variable, #1321).
- **Une règle null ne crée aucune exigence.** Plan `needsReview` → `progress.unconfirmed`.
- **Payouts détectés** (`TradovatePayoutsService`, rapport `Cash History`, même cadence que les
  clôtures, curseur `BrokerConnection.payoutsCheckedThrough` qui n'avance que si toutes les
  fenêtres ont abouti) → table `BrokerPayout`. Payout **certain** = `ChallengePayout` (tout signe)
  ou `FundTransaction` NÉGATIF, et **`ManualAdjustment` NÉGATIF ≥ 100 $ sur un compte FUNDED**
  (`PROBABLE_PAYOUT_MIN`) — c'est ainsi qu'Apex inscrit ses payouts (beta 2026-10-04 : 3
  ajustements = les 3 seules baisses de solde inexpliquées par le P&L sur 146 séances ; confirmé
  par le trader : « une baisse du solde sans trade est forcément un payout »). Jamais en évaluation
  (resets) ; `Debit` exclu. **Filet** (`balanceDrops`, `changeType: balancedrop`) : sur un compte
  funded, toute baisse de solde ≥ 100 $ que le P&L de la séance n'explique pas, lue dans
  `BrokerDailyClose`, compte comme payout si aucun payout connu (détecté OU écarté) n'existe à un
  jour près ; une transaction de l'historique de trésorerie arrivée ensuite le remplace. Couvre une
  firme qui inscrirait ses payouts sous un type inconnu. Un payout reste écartable par l'utilisateur (`POST /accounts/:id/payouts/:payoutId/dismiss`
  → `dismissedAt`, jamais supprimé pour ne pas être recréé). Types en
  libellés lisibles (`" Trade Paired"`) → `normalizeChangeType`. Chaque passage journalise les
  types lus avec leur nombre (jamais de montant) : **vérifier sur beta, avec de vrais comptes payés,
  que les payouts passent bien par ces types** avant d'en dépendre.
- Cycle = le plus récent entre le dernier payout détecté et `lastPayoutAt` saisi ; s'il vient du
  broker, `payoutsReceived` = rang exact pour les paliers (`progress.cycleSource`).
- Séances : `sessionPnlsSql` (liste) ≡ `sessionPnls` (étalon JS), journée CME, `pnl − commission`.

### Drawdown selon le plan prop firm relié (2026-10-03)

Compte relié à un plan du catalogue (`propFirmPlanId`) **et** de type EVALUATION (phase
`evaluation`) ou FUNDED (`funded`, sinon `direct`) : `ruleMetricsFromAgg(compte, agg, plan)`
prend montant, type, verrouillage et solde de départ dans la phase, **pas** la saisie manuelle.
- `trailing_eod` → plus haut P&L de fin de **journée de trading CME** (`maxEodCumulative`,
  `tradingDay()` : date de « heure de Chicago + 7 h », 17:00 CT = 18:00 ET ; même règle en SQL).
  `trailing_intraday` → plus haut après chaque trade (`maxCumulative`, pics en position inconnus).
- `locks_at` / `locked_floor` décalés de `solde du compte − starting_balance de la phase`.
  `locks_at` null (verrouillage déclenché par un payout) → le seuil continue de suivre.
- **Verrouillage propre à la plateforme** (`max_drawdown.platform_overrides`, Apex seulement :
  figé sur Rithmic / Wealthcharts, jamais sur Tradovate). Plateforme = `tradovate` si le compte a
  une connexion Tradovate, sinon `TradingAccount.platform` (saisi dans le formulaire, proposé
  seulement si `PropFirmPlanSummary.platformDependent` est non vide). Connue → `locks_at` /
  `locked_floor` de l'override, `rule.platform` ; inconnue → règle par défaut (jamais figée, la
  plus prudente) et `rule.platformChoices` pour l'avertir.
- Montant null → `drawdown: null` + `drawdownUnconfirmed: true` (jamais de chiffre inventé).
- **Plancher à confirmer** (#1233) : plan `needs_review` dont la règle fige le plancher (`locks_at`
  ou `locks_on_first_payout`) → `rule.floorUnconfirmed: true` et le `disclaimer` ajoute « Plancher à
  confirmer : ce plan est à revoir chez nous, vérifie chez ta firm quand il se fige. » (formulation
  sans cause : `needs_review` est posé sur tout le plan, sans motif). Le chiffre reste affiché (pas de
  `drawdownUnconfirmed`) ; l'app le signale dans le texte du gel (Mes comptes) et l'aide de la carte
  Drawdown. Plan à revoir sans aucun gel : rien de signalé.
- `drawdown.source` (`plan` | `manual`) + `drawdown.rule` ; `disclaimer` propre au plan
  (positions ouvertes non incluses si `enforced_on = equity_realtime`, payouts non suivis).
- Autres types de compte ou sans plan : calcul manuel inchangé (jours UTC, STATIC / TRAILING).
- **Fonctions partagées** (`libs/shared/src/prop-firm-rules/drawdown-floor.ts`), source unique du
  suivi du compte ET de la carte Drawdown des Statistiques : `planDrawdownRule(phase, compte)`
  (override plateforme, décalage du solde de départ), `drawdownPeakProfit(type, agg, equity, officiel)`
  (plus haut retenu), `drawdownFloor(règle, plus haut)` (statique, suiveur, gel). Ne jamais
  recalculer un plancher ailleurs : changer la règle dans ces fonctions seulement.
- **Test sur tout le catalogue** : `apps/app-mytradingcoach/src/app/core/services/chart-floor.catalog.spec.ts`
  rejoue un scénario générique sur chaque phase et chaque variante de plateforme (580 cas au
  2026-10-20) : marge de l'en-tête = écart courbe / limite au dernier point = suivi du compte, et la
  courbe touche la limite exactement quand le solde touche le plancher. Un plan ajouté au catalogue
  est testé sans rien écrire.
### Stats du journal en SQL (SCA-B2-02, 2026-10-02)

`GET /trades/stats` → `journalStatsSql` (journal-stats.util.ts), plus de chargement des trades.
**Le filtre existe en deux versions côte à côte** dans `trade-filters.util.ts` :
`buildTradeWhere` (Prisma, liste paginée) et `buildTradeFilterSql` (SQL, stats). **Tout nouveau
filtre ou changement de filtre se fait dans les deux** ; `journal-stats-sql.int-spec.ts` vérifie
pour chaque filtre et 80 combinaisons que les deux sélectionnent les mêmes trades, et que les
stats égalent l'étalon `summarizeJournal`.

### Arrondi unique du P&L net : `roundCents` (2026-10-03, #293)

**Une seule règle dans toute l'app** : arrondi au centime, au demi **le plus loin de zéro**, sur la
valeur **décimale** du nombre (10,575 → 10,58 · −3,545 → −3,55). JS : `netPnl` / `roundCents`
(`libs/shared/trade-stats.ts`, arithmétique sur les chiffres, jamais de mise à l'échelle
flottante). SQL : `round((pnl - abs(coalesce(commission,0)))::text::numeric, 2)` — **toujours
`::text::numeric`**, jamais `::numeric` seul (conversion à 15 chiffres, qui diverge sur le bruit
flottant). Vérifié identique sur 200 000 paires aléatoires. L'ancien `toFixed(2)` arrondissait selon
la valeur binaire (10,575 → 10,57) : 7 trades sur 979 en prod changent d'1 centime.
Les tests d'équivalence SQL doivent contenir des montants à **3 décimales** (demi-centimes).
**Garde-fou (audit des chiffres, lot 3)** : `src/money-rounding.guard.spec.ts` interdit tout arrondi
numérique « à la main » (`+(x).toFixed(2)`, `Number(x.toFixed(2))`, `Math.round(x * 100) / 100`) dans
l'API, les deux fronts et les libs : montants, frais, commissions, totaux, ratios passent par
`roundCents`. Le formatage d'un texte (`${x.toFixed(2)} EUR`) reste permis. Seule exception, listée
dans le spec : l'étalon figé `src/test/analytics-legacy.service.ts`.
**P&L stocké au centime (B1, #981)** : `create` stocke `roundCents(dto.pnl)` (même avec une entrée à 0),
`calculatePnl`, le mapper Tradovate et le formulaire arrondissent par `roundCents`. Les trades importés
avant gardent leur P&L brut ou arrondi par l'ancien `toFixed` : `dedupeKey` arrondit le P&L au centime
(un P&L déjà au centime garde sa clé d'avant), et `CentRoundingPool` (dans `importTrades`) rapproche un
pour un un trade identique dont le P&L ne diffère que d'1 centime d'arrondi (39,845 : `toFixed` 39,84,
`roundCents` 39,85) ; `planFeeRepairs` applique la même tolérance aux trades restés sans clé exacte.
Test d'intégration : `trades/import-pnl-arrondi.int-spec.ts`. Les P&L déjà en base ne sont pas réécrits
(décision de Greg à prendre) : chaque ligne s'affiche au centime, mais les sommes SQL additionnent les
P&L bruts des trades d'avant B1, un total peut donc différer d'1 centime de la somme des lignes affichées.

### Présence et activité : écritures bornées (SCA-B3-02, 2026-10-03)

Deux intercepteurs tournent à CHAQUE requête authentifiée ; ils ne doivent jamais coûter un
aller-retour par requête :
- `PresenceInterceptor` : filtre local par worker (60 s) puis `SET presence:<id> NX EX 60` dans
  Redis → **une seule écriture de `lastSeenAt` par minute et par utilisateur, tous workers
  confondus** (avant : jusqu'à 1/min par worker). Redis en panne → écriture limitée par le filtre local.
- `ActivityTrackingService.markActive` : filtre local à la journée (plus d'appel Redis à chaque
  requête) ; marqué seulement après succès ; si l'écriture en base échoue, la clé Redis du jour est
  retirée pour que la journée soit retentée.

### Appels externes : délai maximal et single-flight (SCA-B3-04, 2026-10-03)

- **Tout `fetch` vers un service tiers passe par `fetchWithTimeout`** (`common/utils/fetch-timeout.ts`,
  5 s par défaut) : sans délai, un fournisseur muet fait attendre la requête indéfiniment. Fait pour
  market-data (Yahoo, Binance, FMP), eco-calendar (FMP), discord. **Reste à faire** (hors B3-04) :
  `integrations/tradovate/*` et `admin/anthropic-cost.service.ts`.
- **Donnée commune mise en cache → `singleFlight`** (`common/utils/single-flight.ts`) : sur une clé
  froide, une seule requête (tous workers) appelle le fournisseur, les autres attendent le cache
  (verrou `sf:<clé>`, `SET NX PX 5000`). Fait pour `getMarketContext`, `getLivePrice` et la
  traduction IA d'une news (`ensureNewsTextFr`, SCA-B3-05 : verrou 30 s). Le `compute` doit remplir
  le cache lui-même ; s'il échoue (verrou relâché, cache vide), les autres réagissent aussitôt :
  `onTimeout` s'il est fourni (**appel payant : ne pas relancer**, renvoyer un repli), sinon ils
  recalculent.

### Corps de requête : brut seulement pour le webhook Stripe (SCA-B3-06, 2026-10-03)

L'app est créée avec `bodyParser: false` ; `config/body-parsers.ts` (`configureBodyParsers`) installe
un parseur JSON qui garde `req.rawBody` **uniquement** sur `POST /api/billing/webhook` (signature
Stripe sur les octets exacts), puis les parseurs JSON / urlencoded standard ailleurs (plus de copie
brute de chaque corps). **Utilisé par `main.ts` ET par `test/integration-app.helper.ts`** : la même
configuration est testée. Une nouvelle route qui a besoin du corps brut (autre webhook signé) →
l'ajouter dans `configureBodyParsers`, pas `rawBody: true` global.

### Cache HTTP des routes publiques (SCA-B3-07, 2026-10-03)

`GET /public/stats` : `@Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')`
(`PUBLIC_STATS_CACHE_CONTROL`). Aucun middleware global ne pose de `Cache-Control` (vérifié :
Helmet ne le fait pas) ; verrouillé par `public-stats-cache.int-spec.ts`. Une donnée publique et
peu changeante → même traitement ; jamais sur une route authentifiée ou personnelle.

### Rôle du process : APP_ROLE (SCA-B6-01, 2026-10-03)

`config/app-role.ts` — `APP_ROLE=web|worker|all` (absent → `all`, comportement historique ;
valeur inconnue → refus au boot).
- `web` : HTTP + sockets (dont le temps réel Tradovate, réparti par bail Redis). **Aucun cron,
  aucun processeur BullMQ** : les files sont alimentées, pas consommées.
- `worker` : crons (sur le worker cron du cluster) + processeurs BullMQ (`debrief`, `stripe`, `email`, `daily-recap`).
- Prérequis du blue/green (B8) : deux conteneurs web coexistent pendant une bascule, un cron ne
  doit donc jamais tourner dans le web.

Règles :
- Nouveau cron / code « une seule fois au boot » → garde `runsCrons()` (jamais
  `process.env['IS_CRON_WORKER']` en direct).
- Nouveau `@Processor` → provider conditionnel `...(runsQueueProcessors() ? [XxxProcessor] : [])`,
  et l'ajouter à `app-role-wiring.spec.ts`.
- Le log de démarrage de chaque worker affiche `[APP_ROLE=… · crons oui/non · files oui/non]`.

### File e-mail (SCA-B5-02, 2026-10-07)

`ResendService.send()` **met en file** (`email`, `modules/resend/email-queue.ts`) au lieu d'envoyer :
`EmailProcessor` (worker seulement) appelle `deliver()` à débit plafonné (`EMAIL_RATE_LIMIT` : 5/s,
global à la file ; Resend = 10 req/s par équipe, clé partagée entre environnements).
- 5 essais, backoff exponentiel 2 s → 16 s. Passagères (`rate_limit_exceeded`, `application_error`,
  `internal_server_error`, exception réseau du SDK) → `RetryableEmailError` → nouvel essai ;
  définitives (quota, adresse invalide, clé) → Sentry tout de suite, pas de nouvel essai. Sentry
  n'est prévenu d'un échec passager qu'au **dernier** essai.
- `idempotencyKey: email/<job.id>/<job.timestamp>` : un essai qui avait abouti malgré une réponse
  perdue ne crée pas de doublon. Jamais `job.id` seul : c'est un compteur par Redis (prod, beta, dev
  et local repartent chacun de 1), et Resend refuse une clé revue sous 24 h avec un autre contenu
  (`invalid_idempotent_request`, non réessayée → e-mail perdu, récap du 2026-10-09).
- File indisponible (Redis en panne) → `send()` envoie en direct (3 essais sur place) : jamais perdu.
- **`RESEND_DRY_RUN=true`** (tests de charge sur beta, #487) : l'appel d'envoi du client Resend est
  remplacé par un journal `[RESEND DRY RUN]` (file ET envois directs), sans compteur ni alerte de quota.
  **Ignoré si `FRONTEND_URL` = l'app de prod** (garde-fou : jamais d'e-mail de prod qui disparaît).
- `send()` ne lève jamais. Envois **hors file** (directs, volontairement) : `sendAdminAlert`,
  `sendAmbassadorApplication` (doit lever pour le formulaire), `sendAmbassadorStatement` (PDF en
  pièce jointe : pas dans Redis).
- Le job contient l'adresse et le HTML (quelques Ko) : supprimé dès l'envoi réussi, échecs gardés 7 j.

### File des récaps quotidiens (SCA-B5-01, 2026-10-07)

`DailyRecapCron` (17 h 30 Paris, lun-ven) ne fait plus qu'**enfiler** un job par accès Premium réel
(PREMIUM, ADMIN, BETA_TESTER, essai / mois offert actif, #627) ayant tradé ce jour
(file `daily-recap`, `modules/daily-recap/daily-recap.queue.ts`) ; `DailyRecapProcessor` (worker,
`concurrency: 3`) génère le récap (appel IA) puis met l'e-mail en file `email`.
- `jobId = recap-<userId>-<AAAA-MM-JJ>` (jour de Paris) et `removeOnComplete: { age: 2 j }` : relancer
  le cron le même jour n'enfile pas de doublon. **Jamais de `:` dans un `jobId`** (BullMQ lève
  « Custom Id cannot contain : »).
- 3 essais, backoff 30 s ; un nouvel essai refait le même récap (`upsert` sur `userId + date`).
- Un redémarrage du worker en pleine passe ne perd plus les récaps restants : ils attendent en file.
- `ResendCron` (rappels de renouvellement) garde sa boucle : depuis B5-02 il ne fait qu'enfiler des
  e-mails, il n'attend plus les envois.
