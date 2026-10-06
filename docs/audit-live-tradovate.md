# Audit · Session live Tradovate (retour de Val, 2026-10-06)

> « L'app suit correctement les trades mais pas réellement en live, seulement si tu sors de ton
> trade. […] Il y a toujours un décalage entre mon résultat sur l'app et Tradovate. »

Audit du code de `origin/dev` (2026-10-06), avant toute implémentation. Chemins relatifs à
`apps/api-mytradingcoach/src/modules/` (API) et `apps/app-mytradingcoach/src/app/` (app).

## Ce que le prompt supposait et qui est déjà en place

Le prompt décrivait un live « polling 30 s seulement ». C'est faux depuis le 2026-10-03 :

- **WebSocket Tradovate `user/syncrequest`** par utilisateur, ouvert dès que l'app est ouverte
  (bail Redis : un seul socket par user dans le cluster) :
  `integrations/tradovate/tradovate-live.service.ts` (classe `TradovateLiveService`),
  `tradovate-live.connection.ts`, `tradovate-live.protocol.ts`.
- Entités souscrites : `fill`, `fillPair`, `position`, `cashBalance`
  (`tradovate-live.protocol.ts`, `TRADE_ENTITY_TYPES` / `LIVE_ENTITY_TYPES`).
- **socket.io MTC → front** existe et marche en cluster (`RedisIoAdapter`, `main.ts:94`) :
  événements `tradovate:trades`, `tradovate:balance`, `tradovate:status`.
- Front : `core/services/tradovate-live-socket.service.ts:70-72,109` → `tradovate:trades` relance
  `SessionStore.refreshLive()` si une session est active ; `tradovate:balance` → `reloadSoon()` des
  comptes (panneau prop firm de la session live).

## Réponses aux questions de l'audit

### 1. Déclenchement de la synchro, et quand un `Trade` est créé

- Événement WebSocket `fill` / `fillPair` / `position` → `onTradeEvent`
  (`tradovate-live.connection.ts:180`) → regroupement 1,5 s par compte (`LIVE_EVENT_DEBOUNCE_MS`,
  `tradovate-live.service.ts`) → `TradovateSyncService.sync` → `tradovate:trades` au front.
- Hors app ouverte : cron de fond toutes les 15 min (`TradovateBackgroundRefreshCron`).
- Un `Trade` n'est créé qu'à partir d'une **paire de fills appariée** (`/fillPair/list`,
  `tradovate-sync.service.ts:251-287`) : **à la sortie, jamais à l'entrée.** C'est la première
  moitié du retour de Val : une position ouverte n'existe pas dans MTC.
- Chaque synchro relit la séance entière (`position/list`, `fillPair/list`, `fill/*`,
  `contract/items`, `contractMaturity/items`, `fillFee/*`, puis l'instantané de solde) : environ
  8 à 10 requêtes. Ce n'est pas incrémental, mais c'est borné : regroupement 1,5 s, verrou
  `tradovate:sync:<id>` (`connections.tryLock`), et dédoublonnage `importHash` à l'écriture. Le
  ticket « synchro complète toutes les quelques secondes » ne se produit plus en pratique : une
  synchro par grappe d'événements de trade, pas par tick.

### 2. Positions ouvertes et P&L latent

- Les positions ouvertes sont **comptées, pas décrites** : `brokerOpenPositions` (nombre) vient de
  l'instantané initial du WebSocket (`initialAccountState`, `tradovate-live.protocol.ts`) et de
  `position/list` à chaque synchro. Ni l'actif, ni le sens, ni la quantité, ni le prix moyen ne
  sont gardés, alors que l'entité `position` les porte (`contractId`, `netPos`, `netPrice`).
- Le latent (`brokerOpenPnl`) vient de `POST /cashBalance/getcashbalancesnapshot`
  (`tradovate-balance.service.ts`, `captureSnapshot`), lu **sur événement seulement** : fin de
  synchro et ouverture de « Mes comptes » (bridé à 20 s). Il n'est donc relu qu'au trade suivant :
  une position qui glisse ne bouge pas à l'écran. Limite déjà notée dans l'agent nestjs.
- **Pourquoi pas en boucle** : la doc officielle de cette route dit
  « Using this endpoint many times in succession is an anti-pattern » et renvoie au WebSocket
  `user/syncrequest`
  (<https://partner.tradovate.com/api/rest-api-endpoints/accounting/get-cash-balance-snapshot.md>).
  Or le WebSocket ne pousse que le solde **réalisé** (`cashBalance.amount`) : le latent dépend des
  cotations et n'est jamais poussé.
- **Cotations** : refusées (`md/subscribeQuote` 401). Cause documentée le 2026-09-29
  (`docs/tradovate-api-capabilities.md` §9 et tableau de la doc NinjaTrader) : il faut la
  permission `Prices:Read` sur l'inscription de l'app **et** un `mdAccessToken` que la réponse
  OAuth ne renvoie pas. Aucun calcul tick par tick possible aujourd'hui, pour personne.

### 3. `getLiveStats()`

- `session/session.service.ts:310` → `computeTradeStats` (`libs/shared/src/trade-stats.ts:134`) :
  un trade sans P&L (ouvert) est ignoré. Le total = **réalisé seul**. Tradovate affiche réalisé +
  latent : tant qu'une position est ouverte, les deux chiffres ne peuvent pas coïncider.
- Pour un compte Tradovate le cas est même plus simple : la position ouverte n'a pas de `Trade` du
  tout (point 1).

### 4. Transport vers le front

- socket.io en place (cf. plus haut). Le polling 30 s (`core/constants/polling.const.ts:10`,
  `session.store.ts:108`) n'est plus qu'un filet : il passe par `visibleInterval`
  (`core/utils/visible-interval.ts`), muet onglet caché, rattrapage au retour.

### 5. Source de l'écart de P&L vu par Val

| Cause | Vérifié | Verdict |
|---|---|---|
| Trades de plusieurs comptes mélangés dans la session | En base prod (lecture seule) : session Tradeify du 2026-10-05 = 22 trades sur 3 comptes, +100,06 $ venant de 2 comptes Apex | **Cause avérée de l'écart de la carte « Publier »**. Corrigé par #496 (1 session = 1 compte), en prod le 2026-10-06 ; session de Val recalculée à 303,40 $. |
| Position ouverte non comptée (latent absent du total) | Code, points 1 et 3 | **Cause avérée du « décalage en live »** : pendant une position, Tradovate montre réalisé + latent, MTC le réalisé seul, et la position n'apparaît qu'à la sortie. |
| Frais non rapatriés | `fillFee/*` lus à chaque synchro (`tradovate-sync.service.ts`), `netPnl` = pnl − commission | Pas une cause : sur la session de Val, les 14 trades Tradeify ont tous leurs frais (26,60 $). |
| Délai de synchro | Regroupement 1,5 s + synchro (~1 s) | Négligeable à la sortie d'un trade. |
| Point value / multiplicateur | P&L Tradovate pris tel quel (`fillPair` + rapport), pas recalculé | Pas une cause pour les trades synchronisés. |

### 6. Tests en conditions réelles

Non faits dans cette session : aucun compte de test Tradovate joignable d'ici (le serveur MCP
`ninjatrader-demo` refuse le jeton). Déjà mesuré et documenté : instantané accessible (`openPnL`
renvoyé, `docs/tradovate-api-capabilities.md` §9), cotations refusées. **Non mesuré** : la latence
de mise à jour d'`openPnL` côté Tradovate pendant une position ouverte.

## Ce que l'audit permet sans market data

1. **Position ouverte visible dès l'entrée** : faisable avec ce qui existe. L'événement
   `position` arrive déjà par le WebSocket ; il suffit d'en garder le contenu (contrat, `netPos`,
   `netPrice`) au lieu de le compter, de résoudre le contrat (`/contract/item`, déjà utilisé), et
   de le pousser au front. Aucune requête en boucle.
2. **Latent qui évolue** : seule source possible = l'instantané, que la doc déconseille
   d'interroger en boucle. C'est une décision produit (voir la question posée à Greg).
3. **Total = réalisé + latent** : faisable dès que le latent est connu, avec sa date affichée.
4. **Réconciliation à la clôture** : déjà le cas (la sortie produit une paire de fills → synchro
   complète avec frais), et la carte « Publier » lit le `totalPnl` de `closeSession()` depuis #496.

## Décision et implémentation (2026-10-06)

**Décision de Greg** : pas de lecture en boucle de l'instantané. Le latent est relu aux événements
du compte et sur « Actualiser » (bridé 20 s), et son âge est affiché.

Livré sur `feat/session-pnl-latent` :

- **API** : la synchro écrit le détail des positions ouvertes (actif, sens, quantité, prix moyen,
  heure) dans Redis (`tradovate-open-positions.ts`, `TradovateBalanceService.recordOpenPositionDetails`).
  Les contrats des positions sont résolus avec ceux des fills, sans requête supplémentaire.
  `GET /session/today/stats` renvoie `broker` : positions, latent broker et leurs dates, pour le
  compte de la session active.
- **App** : bloc « Trade en cours » (bêta) sous les mini-stats : positions, Réalisé / Latent / Total,
  âge du latent, bouton « Actualiser », message « Latent indisponible pour ce compte » quand le
  broker ne l'a pas donné. Chaque `tradovate:balance` relit les stats de la session (regroupé).
- **Pas fait, volontairement** : polling 3 à 5 s (décision ci-dessus), calcul tick par tick (pas de
  cotations), synchro incrémentale (le regroupement + verrou suffisent, cf. point 1).

## Scénario de retest pour Val

1. Ouvrir MTC, onglet Session live, session démarrée sur son compte Tradovate.
2. Entrer en position (1 micro). En 2 à 3 s : le bloc « Trade en cours » montre sens, quantité,
   actif et prix d'entrée, comme Tradovate.
3. Comparer le latent : il vaut celui de Tradovate **à l'heure affichée** (« il y a 40 s »).
   Cliquer « Actualiser » le relit (au plus toutes les 20 s). Il ne suit pas chaque tick.
4. Clôturer la position : le trade apparaît dans le Live feed, « Réalisé » prend son P&L net,
   le latent repasse à 0. Comparer « Réalisé » au réalisé de Tradovate en tenant compte des frais.
5. Clôturer la session, publier la carte : son P&L = « Réalisé » de la session (trades de ce
   compte seulement depuis #496).
