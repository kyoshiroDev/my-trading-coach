# Données à ne jamais exposer

> Contenu déplacé à l'identique depuis `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : prisma.md · Ne jamais exposer · 2026-04-25 -->
> **Origine** : `prisma.md` · « Ne jamais exposer » · 2026-04-25

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

> **Parcours d'inscription** (migration `20261014200000_funnel_event_daily`, oct. 2026, additive) :
> - `LandingVisitDaily.inApp` (BOOLEAN, défaut `false`) entre dans l'unique
>   `(date, path, source, medium, campaign, inApp)`. Le `ON CONFLICT` de `recordLandingVisit` doit
>   lister EXACTEMENT ces colonnes (sinon chaque visite échoue en silence, erreur avalée).
> - `FunnelEventDaily` : compteurs `(date Paris, step, source, medium, campaign, inApp, detail)` → `count`,
>   même principe que `LandingVisitDaily` (`''` = absent, jamais NULL ; upsert `INSERT … ON CONFLICT` +1).
>   `step` : `landing_view` (jamais écrit ici : les visites restent dans `LandingVisitDaily`) ·
>   `cta_click` · `register_view` · `register_submit` · `register_success` · `register_error` ·
>   `checkout_redirect`. `detail` = valeur d'une **liste fermée** (CTA `founder|free|premium`, code
>   d'erreur `email_taken|validation|network|server|other`), sinon `''`.
> - **Aucune donnée personnelle** : ni UA brut (seul le booléen `inApp`), ni e-mail, ni IP, ni
>   identifiant de session, ni lien `User`. Ne jamais y ajouter de colonne identifiante (exemption CNIL).
> - **Engagement landing** (migration `20261019120000_funnel_event_path`, additive) : colonne `path`
>   (`/` | `/prop-firm` pour `scroll_depth` / `time_on_page` / `rules_use`, `''` pour les étapes
>   d'inscription et les lignes antérieures), ajoutée à l'unique
>   `(date, step, source, medium, campaign, inApp, detail, path)`. Le nom d'index, tronqué à 63
>   caractères par Prisma, ne change pas. `detail` porte le seuil (`25|50|75|100` ou `10|30|60`).
