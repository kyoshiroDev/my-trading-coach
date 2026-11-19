# Règles obligatoires de l'API : version détaillée

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Règles obligatoires · 2026-04-25 -->
> **Origine** : `nestjs.md` · « Règles obligatoires » · 2026-04-25

## Règles obligatoires

- **Stats de trades = helper unique** (PROMPT-160) : `computeTradeStats(trades)` de
  `@mtc/shared` (`libs/shared/src/trade-stats.ts`, source unique front + back) (`{ total, closed, wins, losses, breakeven, winRate, totalPnl }`).
  Toute mesure win/loss/win rate/P&L d'un lot de trades passe par lui — **jamais** de
  `filter(t => t.pnl > 0)` suivi d'une division inline. Règle break-even : win `pnl > ε`,
  loss `pnl < -ε`, BE `|pnl| <= ε` (`ε` défaut 0) ; **win rate = wins / (wins + losses)** (BE exclus du
  dénominateur) ; trades ouverts (pnl null) hors calcul. Le front importe le MÊME helper (`@mtc/shared`).
- **P&L = NET partout, via `netPnl`** (PROMPT-213) : `Trade.pnl` est stocké BRUT, les frais dans
  `commission`. `computeTradeStats` classe et somme sur `netPnl(t)` = `pnl − |commission|` : **toute
  requête Prisma qui alimente une stat sélectionne `commission` avec `pnl`** (sinon le calcul retombe
  sur le brut sans erreur). Même règle pour les agrégats écrits à la main (analytics : drawdown,
  profit factor, série, par setup/émotion/heure, courbe, calendrier, top actifs ; session ; débrief ;
  récap et agents IA). Seule exception assumée : la note d'exécution (`execution-grade.util`).
  `AnalyticsService` passe par son helper local `net(t)`. `SetupStat.avgRR` vaut `null` (pas 0)
  quand aucun trade du setup n'a de R:R ; idem `EmotionStat.avgRR` et le « R/R moyen » du PDF de
  débrief (`averageKnownRiskReward` de `@mtc/shared` : moyenne des R/R CONNUS, `null` sinon).
- **R/R inconnu ≠ 0 (#916)** : l'import CSV et le rapport après coup (`BROKER_HISTORY`) n'écrivent
  jamais `stopLoss` / `takeProfit` / `riskReward` (le rapport Orders porte le Stop Price mais sans
  lien vers le trade, cf. `docs/tradovate-api-capabilities.md` §11) ; la synchro de séance les capture
  à l'entrée quand ils sont reliés (voir « Capture du stop à l'entrée »). Un R/R
  absent reste `null` partout (API, PDF, IA). Le trader saisit son stop initial par
  **`PATCH /trades/:id/stop`** (`SetTradeStopDto` : `stopLoss`, `takeProfit` facultatif, `null` =
  retiré) : `TradesService.setStop` refuse un stop ou un objectif du mauvais côté de l'entrée (400,
  message de `stopPlacementError`, `@mtc/shared`) puis passe par `update` → R/R par
  `calculateRiskReward` (= `plannedRiskReward` partagé avec l'aperçu du front), note « avec stop »
  (STOP_BASED) et recalcul comportemental du compte. `update` recalcule le R/R dès que `stopLoss`,
  `takeProfit`, `side` ou un prix change (avant : seulement sur un prix) et l'efface (`null`) s'il
  devient incalculable, sauf R/R fourni par le client. Une resynchronisation n'écrase rien :
  l'import broker n'insère que des trades nouveaux (dédoublonnage), il ne met jamais à jour un trade
  existant (`trade-stop.int-spec.ts`).
- **Capture du stop à l'entrée (#916 phase 2, #925, liaison par stratégie #955)** : `TradovateSyncService.run`
  lit, s'il y a des trades à convertir, `/order/list` + `/orderVersion/list` + `/orderStrategyLink/list`
  (GET, best-effort : un échec ne casse pas la synchro, sauf une pénalité, relancée pour que la pause soit
  notée ; liens de stratégie illisibles = liaison par `parentId` seule) et pose `stopLoss` / `takeProfit`
  dans le DTO de CRÉATION via `entryProtection` (`tradovate-entry-protection.ts`, pur) : ordre d'entrée =
  `orderId` du fill d'entrée, jambes = ordres de la **même stratégie d'ordres** que l'entrée
  (`orderStrategyLink.orderStrategyId`) ou `parentId` = entrée (+ OCO), même compte / contrat, sens
  opposé, PREMIÈRE version, candidat unique par rôle, bon côté ; sinon rien. Un trade existant n'est
  jamais mis à jour (la saisie utilisateur prime). Log de mesure « Capture stop Tradovate » (liés / sans
  jambe liée / ambigus / séance passée), sans montant. `BROKER_HISTORY` (rapport après coup) : pas de
  stop, non validé par Greg. **Constat prod du 2026-11-12** (diagnostic #955, retiré depuis) : brackets
  TradingView sans `parentId` / `ocoId` / `linkedId` ; entrée, stop et objectif partagent une stratégie
  (3 ordres par stratégie). `/orderStrategy/list` n'est pas lu (inutile à la liaison). Jamais d'inférence
  par id voisin (non validée).
- **Borne haute des périodes analytics** : un `to` date seule (`2026-09-14`) couvre la journée
  entière (`AnalyticsController.endBound`) ; lu tel quel il valait minuit et excluait les trades du jour.
- **Setup des trades importés = « Sans setup »** (PROMPT-213) : la synchro broker, l'import CSV sans
  setup choisi et le repli d'un `setupId` périmé (`resolveBatchSetupId`) passent par
  `SetupsService.getImportSetupId`, qui trouve ou crée (ou désarchive) le setup `IMPORT_SETUP_TITLE`
  (`#6b7280`, sortOrder 999). Plus de repli sur le premier setup du user (qui rangeait tout en
  « Breakout » et faussait les stats par setup).
- **Devise = propriété DU COMPTE, jamais convertie, jamais globale** (PROMPT-214) :
  `TradingAccount.currency` ∈ `ACCOUNT_CURRENCIES` (`@mtc/shared`, liste unique front + back ;
  DTO create/update : `@Transform(normalizeCurrencyCode)` + `@IsIn`). Compte synchronisé : devise
  **lue chez le broker** par `TradovateConnectionService.resolveAccountCurrency`
  (`/cashBalance/list` → `currencyId` du compte, puis `/currency/item?id=` pour le code), posée à la
  sélection du compte ET à la reconnexion quand le compte déjà choisi est gardé ; **refusée** en
  update (`AccountsService.update`, 400). ⚠️ **`currencyId` est un identifiant INTERNE Tradovate**
  (1 = USD, 2 = EUR…), **pas un code ISO 4217** : jamais de table en dur, toujours `/currency/item`
  (mesuré le 2026-09-20, cf. `docs/tradovate-api-capabilities.md` §2). Lecture best-effort : token
  inexploitable, endpoint indisponible ou devise hors `ACCOUNT_CURRENCIES` (ex. CAD) → repli
  `DEFAULT_ACCOUNT_CURRENCY` + `logger.warn`, jamais d'échec de la sélection de compte. Montants serveur visibles (emails débrief / recap, PDF,
  prompts IA) : `formatMoney` avec la devise du compte (arrondi au plus proche, centimes gardés
  sous 1 $ même à `decimals: 0` : -0,80 → `-$0.80`, cf. `angular.md`), ou `userAmountsCurrency()`
  (`common/utils/user-currency.util.ts` : devise commune des comptes non archivés, `null` si mêlées
  → sans symbole). **Plus aucun taux** : `User.currencyRate` n'est plus lu ni écrit (ni
  exchangerate-api, ni cache). Les champs `currency` des DTO onboarding / préférences sont encore
  ACCEPTÉS mais IGNORÉS (`@deprecated`, pour ne pas rejeter un front en cache avec
  `forbidNonWhitelisted`) : à retirer avec les colonnes (migration séparée, cf. `prisma.md`).
  Seuls `$` en dur tolérés : logs internes (coût Anthropic, réellement en USD).
- **Filtre journal « émotion effective »** (PROMPT-166) : l'émotion effective d'un trade =
  `trade.emotion` (override) `??` `tradeSession.moodStart` (humeur de session). Filtrer dessus dans
  `buildTradeWhere` = un **`OR` Prisma** sur les deux sources — `[{ emotion: V }, { emotion: null,
  tradeSession: { moodStart: V } }]`. Ne générer une branche que si `V` appartient à l'enum concerné
  (`Object.values(EmotionState/MoodState).includes(V)`), sinon Prisma throw sur enum invalide :
  `TIRED` → MoodState seul (2ᵉ branche), `REVENGE`/`FEAR` → EmotionState seul (1ʳᵉ branche).
  `NONE` = `{ emotion: null, OR: [{ sessionId: null }, { tradeSession: { moodStart: null } }] }`.
  Filtre `result` : réutiliser le **même `ε`** (`BREAKEVEN_EPSILON`, `@mtc/shared`), jamais un
  seuil local. **Mêmes filtres appliqués à la liste ET aux stats** (`buildTradeWhere` factorisé) sinon
  les KPIs mentent.
- **`effectiveEmotion` sur TOUTE réponse portant un trade** (PROMPT-200). Le champ est
  calculé, pas stocké : chaque endpoint qui renvoie un trade doit inclure
  `tradeSession: { select: { moodStart: true } }` **et** poser
  `effectiveEmotion: effectiveEmotion(t)`. `findAll` le faisait, `create`/`update` non :
  le front remplace l'objet en store par la réponse, donc un champ absent **écrasait**
  la valeur affichée et l'UI retombait sur « non renseignée » jusqu'au rechargement
  (retour Nath). Dans `update`, le calcul va **après** le bloc de recalcul d'exécution,
  qui réécrit `result`. Piège de test : un double Prisma renvoie `tradeSession` quel que
  soit l'`include` — un test qui ne vérifie que la valeur passe au vert avec le bug
  intact. Vérifier l'`include` lui-même.
- **Ambassadeur = `role === 'AMBASSADOR'`, JAMAIS « a un referralCode »** (PROMPT-176).
  `User.referralCode` est **partagé** entre les deux parrainages : un USER qui génère
  son code en a un **sans** être ambassadeur. Tout filtre/compteur basé sur la présence
  d'un code est faux (le bug : Lucas le compte démo et un BETA_TESTER remontaient dans
  la liste admin). Corollaire : un `AMBASSADOR` doit **toujours** avoir un code — les
  changements de rôle passent par `AmbassadorService.promote()` / `revoke()`, jamais par
  un `user.update({ data: { role } })` direct. `UsersService.setRole` y délègue ; la modale
  « Modifier » de l'admin (`PATCH /admin/users/:id`) n'accepte plus `role` ni `plan` (A1/B2 #1064).
  Compte démo : jamais supprimé, modifié, changé de rôle ni promu depuis l'admin (409, B9 #1064).
  `promote` refuse ADMIN / BETA_TESTER (400, jamais rétrogradés) ; `revoke` refuse tout rôle autre
  qu'AMBASSADOR (#1013 A6). `GET /ambassador/new-count?since=` invalide → 400.
  Compte démo : jamais parrain. `GET /referral/me` ne lui écrit pas de code (réponse vide), l'inscription
  ignore un code démo et `referralApplies` refuse un parrain `isDemo`.
  Backfill : `tools/scripts/backfill/ambassador-codes.ts` (idempotent).
- **Règle de coexistence du parrainage** : c'est le **rôle du parrain** qui décide, dans
  `processReferral` (`stripe-referral.service.ts`). Parrain `AMBASSADOR` → commission cash 20 %
  (`ReferralCommission`, une ligne par facture `invoiceId`, A1 #1013), **jamais** de mois offert.
  Remboursement intégral du 1er paiement du filleul : `settleReferralRewardsOnRefund` (webhook
  `charge.refunded`, A4). Parrain `USER` → mois offert
  (`ReferralReward`) + coupon filleul au checkout, **jamais** les 20 %. Auto-parrainage
  ignoré. Couvert par `stripe-referral.service.spec.ts` (unitaire) et
  `referral-coexistence.int-spec.ts` (intégration, vraie stack).
- **Module Stripe** (`modules/stripe/`), un service par responsabilité, tous sur le même
  client injecté `STRIPE_CLIENT` (`stripe.client.ts`, version d'API épinglée) :
  `StripeBillingService` (routes /billing : statut en cache Redis, checkout, portail) ·
  `StripeWebhookService` (signature + idempotence + enqueue, puis un handler par type
  d'événement) · `StripeSubscriptionService` (synchro DB ← Stripe, cache, liste admin) ·
  `StripeReferralService` (commission / mois offert) · `StripeCustomerService` (customer
  sans doublon, avoir) · `StripeCouponService` (coupons filleul). Nouvel événement webhook
  = un `case` + un handler privé dans `StripeWebhookService`. Dans les specs, passer un
  mock Stripe au constructeur ; ne pas réassigner un champ privé.
- **Suppression d'un compte MTC (`DELETE /api/users/me`, `DELETE /api/admin/users/:id`)** :
  `archiveAndDelete` résilie d'abord, **immédiatement**, tous les abonnements non terminés du
  customer Stripe (actif, essai, impayé, incomplet : pas seulement `stripeSubscriptionId`) via
  `StripeAccountClosureService` (`modules/stripe/stripe-account-closure.service.ts`), sans prorata
  ni remboursement. Stripe en échec → **503** `BILLING_CLOSURE_FAILED_MESSAGE`, rien supprimé ni
  tracé (l'utilisateur réessaie). Customer inconnu de Stripe → rien à résilier, suppression
  normale. Le service est fourni par `UsersModule` avec son propre `stripeClientProvider`
  (importer `StripeModule` ferait un cycle Users → Stripe → Discord → Users). Les webhooks qui
  arrivent ensuite pour ce customer ne trouvent plus d'utilisateur : ils ne lèvent pas, n'écrivent
  rien, et l'alerte Sentry `past_due` / `unpaid` est sautée quand le customer n'a plus de compte.
  Rattrapage des suppressions antérieures : `scripts/list-orphan-stripe-subscriptions.ts`
  (lecture seule). Tests : `users-delete.spec.ts`, `stripe-account-closure.service.spec.ts`,
  `stripe-webhook.service.spec.ts`, `delete-me-stripe.int-spec.ts` (mode test Stripe).
  Redis : après la suppression, `ai:insights:last:<userId>` (dernière analyse IA) et
  `ai:cooldown:insights:<userId>` sont effacés (`modules/ai/insights-cache-keys.ts`, #1056) ; Redis en
  panne → avertissement, la suppression aboutit, les clés expirent seules sous 4 h.
  ⚠️ Commissions ambassadeur `pending` : emportées par la cascade à la suppression de
  l'ambassadeur (aucune trace côté admin).
- `@UseGuards(JwtAuthGuard)` sur toutes les routes protégées
- `@UseGuards(PremiumGuard)` sur routes IA et analytics avancés
- `@UseGuards(JwtAuthGuard, AdminGuard)` sur TOUTES les routes `/vps/*`, `/docker/*`, `/admin/*`
- **Route admin = sous `/admin`**, dans un contrôleur gardé AU NIVEAU DE LA CLASSE (`AdminController`,
  `AdminUsersController`, `AdminAmbassadorsController`) : jamais de `@UseGuards(AdminGuard)` route par route
  dans un contrôleur utilisateur. Test : `modules/admin/admin-routes.spec.ts`.
- Déplacer une route : garder l'ancienne une version avec `@DeprecatedRoute('GET /nouvelle')`
  (`common/decorators`) qui journalise un `warn` à chaque appel ; la supprimer quand les logs sont muets.
  En cours : `/users/admin/*`, `/ambassador/list|admin/*|pay-all/*`, `/referral/admin/overview`,
  `/trades/{market-context,news,live-price,instruments,user-assets,favorite-asset}`.
- `@UseGuards(JwtAuthGuard, BetaGuard)` sur routes V2 session mode (BETA_TESTER + ADMIN)
- `/api/analytics/summary` : PAS de PremiumGuard (FREE y accède)
- `ValidationPipe` global : `whitelist: true, forbidNonWhitelisted: true`, défini par
  `createValidationPipe()` (`config/validation-pipe.ts`, partagé avec les tests). Un `@Body()` typé en
  ligne (`{ reason?: string }`) n'est jamais validé (type `Object` à l'exécution) : toujours une classe DTO.
  Test d'un corps : appliquer `createValidationPipe()` au type réel du paramètre
  (`Reflect.getMetadata('design:paramtypes', …)`, cf. `users/delete-bodies-validation.spec.ts`, #1069).
- Ne jamais appeler Prisma dans les controllers
- Imports profonds : alias `@api/…` (= `src/`, ex. `@api/common/guards/jwt-auth.guard`), déclaré dans
  `tsconfig.base.json`, `webpack.config.js` et les deux `vitest*.config.mts`
- Ne jamais `console.log` → Logger NestJS
- Argon2 pour les mots de passe (jamais Bcrypt)
- JWT : access_token 15min, refresh_token 7j httpOnly cookie
- SSH credentials uniquement via variables d'env — jamais en dur, jamais en BDD
  - `VPS_HOST`, `VPS_USER=greg`, `VPS_SSH_KEY_B64=<base64>` : serveur `principal` (celui de l'API ;
    en prod = VPS prod 149.202.40.240 depuis la migration du 2026-10-15)
  - Serveur `secondaire` (en prod = ancien VPS 51.83.197.230, dev + beta) : **lecture seule, clé
    dédiée** (2026-10-16, NODE-NESTJS-6). Proposé seulement si `VPS_SECONDARY_HOST` **et**
    `VPS_SECONDARY_SSH_KEY_B64` sont définis ; utilisateur `VPS_SECONDARY_USER` (défaut `mtc-monitor`),
    empreinte d'hôte optionnelle `VPS_SECONDARY_HOST_KEY_SHA256` (format `ssh-keygen -lf`). **Jamais de
    repli sur `VPS_SSH_KEY_B64`.** `VPS_LABEL` / `VPS_SECONDARY_LABEL` = libellés des onglets.
  - Côté ancien VPS, la clé a une commande forcée (`infra/vps/mtc-monitor-ro.sh`) qui n'exécute que les
    commandes de `infra/vps/mtc-monitor-allowed-commands`, à l'identique. Ce fichier est généré depuis
    `vps-commands.ts` (`VPS_READ_COMMANDS`) et `vps-commands.spec.ts` vérifie l'alignement : **toute
    commande de lecture nouvelle ou modifiée → régénérer le fichier ET le recopier sur l'ancien VPS**
    (`/etc/mtc-monitor/allowed-commands`), sinon le secondaire la refuse.
  - Secondaire : start / stop / restart / suppression / logs → **403 `VPS_READ_ONLY` avant tout appel
    SSH** (`DockerService.assertFullAccess`). `/vps/servers` renvoie `[{ id, label, readOnly }]`.
  - Serveur injoignable → **503 `VPS_UNREACHABLE`** (`ExpectedOutageException`), message avec la raison
    (« authentification refusée », « délai dépassé »…). Plus de tentative SSH vers ce serveur pendant
    60 s (`VPS_RETRY_DELAY_MS`), une seule tentative pour les requêtes simultanées. **Une seule alerte
    Sentry par panne** (`warning`, au passage joignable → injoignable, dédupliquée entre process par
    la clé Redis `vps:down:<id>`) ; le filtre global n'envoie pas `ExpectedOutageException` à Sentry.
    `extra` = `{ reason, name, code }` : jamais le message SSH (hôte et port), qui reste dans le log.
  - `VpsService.exec()` lève **502 `VPS_COMMAND_FAILED`** si le code de sortie n'est pas 0 (avant, une
    commande refusée passait pour un succès). `getStats` reste tolérant (sortie vide → 0).
  - `?server=principal|secondaire` sur `/vps/stats`, `/docker/*`, `/vps/logs/:container` (absent =
    principal ; non configuré → 400). Une connexion SSH par serveur (`vps-servers.ts`).
    Le dashboard, le cron metrics-snapshot et les backups restent sur le principal.
  - Ids de container validés (`[a-zA-Z0-9_.-]`) avant la commande SSH (pas d'injection)
- **Tests et horloge** : tout test qui fixe une date fige l'horloge (`freezeClock(date)`,
  `src/test/freeze-clock.ts`), car le code lit l'heure réelle (`new Date()`, `now = new Date()` par
  défaut). Contrôle sous une autre date : `tools/scripts/shifted-clock.mjs` (voir `tests.md`).
