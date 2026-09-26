# API Tradovate — ce qu'elle permet, pour MyTradingCoach

> Relevé documentaire du 2026-09-20. Sources parcourues :
> - référence principale <https://api.tradovate.com/> (page unique Redoc, ~312 000 caractères) ;
> - doc Partner <https://partner.tradovate.com/>, dont l'index complet <https://partner.tradovate.com/llms.txt>
>   (464 pages, chacune disponible en `.md` : c'est la source citée ci-dessous, plus fiable à citer
>   que la page unique) ;
> - tutoriel OAuth officiel <https://github.com/tradovate/example-api-oauth>.
>
> Contexte : notre intégration est en **lecture seule** (aucun ordre placé) et vise des comptes
> **prop firm en évaluation**, qui vivent sur le domaine DEMO.
>
> ⚠️ Quand la doc ne dit rien sur un point, c'est écrit noir sur blanc ci-dessous. Les constats
> issus de notre propre intégration (et non de la doc) sont marqués **[terrain]**.

---

## 1. Authentification et environnements

### Deux voies d'authentification

| Voie | Pour qui | Endpoint | Durée de vie |
|---|---|---|---|
| **OAuth** (la nôtre) | app tierce agissant pour le compte d'un utilisateur | `POST /auth/oauthtoken` | `expires_in` **3 600 s** (1 h), `refresh_token_expires_in` **1 209 600 s** (14 j) dans l'exemple de la doc |
| **Clé API** (identifiants directs) | partenaire / serveur qui possède le compte | `POST /auth/accesstokenrequest` | **80 minutes** côté Partner, **90 minutes** côté doc principale |

- OAuth : paramètres `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`, `refresh_token`,
  `code_verifier` ; réponse `access_token`, `refresh_token`, `token_type`, `expires_in`,
  `refresh_token_expires_in`, `id_token`.
  <https://partner.tradovate.com/api/rest-api-endpoints/authentication/o-auth-token.md>
- Écran de consentement : `https://trader.tradovate.com/oauth?response_type=code&client_id=…&redirect_uri=…`,
  puis échange du code contre un jeton. Le tutoriel officiel **ne documente aucun nom de scope**.
  <https://github.com/tradovate/example-api-oauth>
- Clé API : « Access tokens expire after **80 minutes** », renouvellement par
  `POST /auth/renewAccessToken` « before expiration » ; vérification par `GET /auth/me`.
  <https://partner.tradovate.com/overview/quick-setup/auth-overview.md>
- Doc principale : « Access Tokens have a natural lifespan of **90 minutes** from creation », appeler
  le renouvellement « about 15 minutes prior to the expiration ». Limite de **2 sessions simultanées**
  par utilisateur : au-delà, les plus anciennes sont fermées (erreurs 408/429/500 ensuite).
  <https://api.tradovate.com/> section *Authentication → Expiration and Renewal*
- Usage du jeton : schéma `Authorization: Bearer <token>` sur REST et sur la WebSocket
  (requête `authorize`).

**Écart à noter** : 80 min (Partner) contre 90 min (doc principale). Se fier au champ
`expirationTime` / `expires_in` renvoyé, jamais à une constante en dur.

### Domaines

| Rôle | Production | Staging (dev) |
|---|---|---|
| Comptes **LIVE** | `https://live.tradovateapi.com/v1` | `https://live-api.staging.ninjatrader.dev/v1` |
| Comptes **DEMO** (simulation) | `https://demo.tradovateapi.com/v1` | `https://demo-api.staging.ninjatrader.dev/v1` |
| Données de marché (WebSocket) | `wss://md.tradovateapi.com/v1/websocket` | `wss://md-api.staging.ninjatrader.dev/v1/websocket` |
| Market Replay | `wss://replay.tradovateapi.com/v1/websocket` | `wss://replay.staging.ninjatrader.dev/v1/websocket` |
| Client web | `trader.tradovate.com` | `trader.staging.ninjatrader.dev` |
| Dashboards admin | `dashboards.tradovate.com` | `dashboards.staging.ninjatrader.dev` |

<https://partner.tradovate.com/resources/reference/environments.md>

**Prop firm / évaluation = DEMO.** La page de gestion prop firm indique que les comptes
d'évaluation sont créés dans l'environnement **demo** (les *users*, eux, sont créés côté Live),
via `POST /user/createevaluationaccounts`.
<https://partner.tradovate.com/overview/prop-firm-management/create-and-manage-users-and-accounts.md>
La page Environments qualifie le domaine demo de « simulated trading for evaluation and testing
purposes ». **[terrain]** C'est cohérent avec nos comptes Apex / Tradeify, qui répondent sur
`demo.tradovateapi.com`.

---

## 2. Comptes, soldes, devise et positions (notre usage principal)

| Endpoint | Ce qu'il renvoie |
|---|---|
| `GET /account/list` | tous les comptes visibles par l'utilisateur connecté : `id`, `name` (ex. `X0314`), `userId`, `accountType`, `active`, `clearingHouseId`, `marginAccountType`, `legalStatus` |
| `GET /account/item?id=` · `/items?ids=` · `/find?name=` | le même objet, par id, par lot, par nom |
| `POST /cashBalance/getcashbalancesnapshot` (body `accountId`) | photo du compte : `totalCashValue`, `netLiq`, `openPnL`, `realizedPnL`, `weekRealizedPnL`, `initialMargin`, `maintenanceMargin`, `netLiqSOD`, `cashUSD`, `autoLiqLevel` — **pas de `currencyId`** |
| `GET /cashBalance/list` · `/item?id=` | entité CashBalance : `accountId`, `timestamp`, `tradeDate`, **`currencyId`**, `amount`, `realizedPnL`, `weekRealizedPnL`, `amountSOD` |
| `GET /cashBalanceLog/item?id=` · `/list` | mouvements : `accountId`, `timestamp`, `tradeDate`, `currencyId`, `amount`, `cashChangeType` (Commission, Debit, FundTransaction…), `delta`, `realizedPnL`, `weekRealizedPnL`, `fillPairId`, `fillId`, `comment` |
| `GET /position/list` · `/find` · `/deps?masterid=` | position par contrat : `accountId`, `contractId`, `timestamp`, `tradeDate`, `netPos`, `netPrice`, `bought`, `boughtValue`, `sold`, `soldValue`, `prevPos`, `prevPrice` |
| `GET /accountRiskStatus/list` | statut de liquidation automatique du compte |
| `GET /tradingPermission/list` | permissions de trading du compte |

Sources : <https://partner.tradovate.com/api/rest-api-endpoints/accounting/account-list.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/accounting/get-cash-balance-snapshot.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/accounting/cash-balance-item.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/accounting/cash-balance-log-item.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/positions/position-list.md>

### Où lire la devise d'un compte

- **`CashBalance.currencyId`** (et `CashBalanceLog.currencyId`) : un **entier**.
  <https://partner.tradovate.com/api/rest-api-endpoints/accounting/cash-balance-item.md>
- ⚠️ **Ce n'est PAS un code ISO 4217**, contrairement à ce que laisse croire l'exemple `840` de la
  doc. **[terrain, 2026-09-20]** Le compte de Val renvoie `currencyId: 1`, et
  `GET /currency/item?id=1` donne `{"id":1,"name":"USD","symbol":"$"}`. `GET /currency/list` renvoie
  14 devises, dont `2 = EUR`, `5 = CAD`, `9 = CHF`. **Il faut donc toujours résoudre l'identifiant
  via `/currency/item` ou `/currency/list`**, jamais le traiter comme un code ISO.
  <https://partner.tradovate.com/api/rest-api-endpoints/contract-library/currency-item.md>
  ✅ **Corrigé dans MTC** : `TradovateConnectionService.resolveAccountCurrency` lit
  `/cashBalance/list` puis `/currency/item?id=` ; la constante USD en dur a disparu. Repli sur USD
  avec `warn` si la lecture échoue ou si la devise n'est pas dans `ACCOUNT_CURRENCIES`.
- **`account/list` ne porte aucune devise** et le *snapshot* non plus : la seule voie documentée
  passe par `cashBalance`. C'est exactement l'hypothèse posée dans notre code
  (`TRADOVATE_ACCOUNT_CURRENCY`, avec son TODO).
- À savoir : il existe une page « EU to USD balance conversion », signe que des comptes non-USD
  existent bel et bien côté Tradovate.
  <https://partner.tradovate.com/resources/reference/eu-to-usd-balance-conversion.md>

---

## 3. Trades et exécutions

| Endpoint | Ce qu'il renvoie |
|---|---|
| `GET /fill/list` · `/item?id=` · `/items?ids=` · `/deps?masterid=` · `/ldeps?masterids=` | exécution unitaire : `orderId`, `contractId`, `timestamp`, `tradeDate`, `action` (Buy/Sell), `qty`, `price`, `active`, `finallyPaired` |
| `GET /fillPair/list` · `/item` · `/items` · `/deps` | aller-retour apparié : `positionId`, `buyFillId`, `sellFillId`, `qty`, `buyPrice`, `sellPrice`, `active` — **aucun timestamp, aucun P&L** |
| `GET /fillFee/list` · `/item` | frais par exécution : `clearingFee`, `exchangeFee`, `nfaFee`, `brokerageFee`, `ipFee`, `commission`, `orderRoutingFee`, chacun avec son `…CurrencyId` |
| `GET /executionReport/list` · `/item` | rapport d'exécution : `accountId`, `contractId`, `orderId`, `timestamp`, `execType` (Trade, Completed, Rejected…), `action`, `cumQty`, `avgPx`, `lastQty`, `lastPx`, `ordStatus`, `tradeDate`, `exchangeOrderId` |
| `GET /order/list` · `/item` · `/orderVersion/*` | ordres et leurs versions successives |
| `GET /commandReport/list` | rapports de commande (cycle de vie d'un ordre) |

Sources : <https://partner.tradovate.com/api/rest-api-endpoints/orders/fill-list.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/positions/fill-pair-list.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/orders/fill-fee-list.md> ·
<https://partner.tradovate.com/api/rest-api-endpoints/orders/execution-report-list.md>

### Reconstituer un trade complet

Aucun endpoint ne renvoie « un trade » prêt à l'emploi. Il faut joindre nous-mêmes, ce que la doc
assume explicitement : « The API exposes data with fine granularity… It is the responsibility of
client applications to request all needed dependencies and join them » (<https://api.tradovate.com/>,
section *Conventions*).

Chemin : `fillPair` (entrée/sortie, quantité, prix) → `fill` (horodatage, sens, contrat) →
`contract` (symbole) → `fillFee` (frais) → P&L calculé par nous
(`(sellPrice − buyPrice) × qty × valuePerPoint`).

### La limite historique, précisément

**Ce que dit la doc** : `/list` « retrieves a list of all of the entities that are within the
**logged on user's visible scope** » (<https://partner.tradovate.com/resources/reference/api-cheat-sheet.md>).
Le terme « visible scope » n'est défini nulle part. **Aucune page de la doc Tradovate — ni
api.tradovate.com, ni les 464 pages Partner — n'énonce de politique de rétention, de fenêtre
temporelle, ni de paramètre de date sur `fill`, `fillPair`, `executionReport` ou `order`.** Aucun de
ces endpoints n'accepte `startDate` / `endDate` : leurs seuls paramètres sont `id`, `ids`,
`masterid`, `masterids`.

**[terrain]** Notre intégration observe ceci, et c'est notre point de blocage :
- session en cours : `fill/list`, `fillPair/list` renvoient les entités du jour, correctement ;
- session close : les entités ne sont plus renvoyées, y compris par `fillPair/items?ids=` ;
- `/xxx/items?ids=` répond **404 avec un corps vide** au-delà d'une dizaine d'identifiants (d'où
  notre lot de 10) ;
- **`cashBalanceLog` ne sauve rien non plus.** Mesuré le 2026-09-20 sur le compte de Val :
  `GET /cashBalanceLog/list` renvoie **2 lignes au total**, dont **1 seule** pour son compte, de type
  `NewSession`, datée du jour. Les mouvements liés à ses 28 trades du 14/09 ont disparu.
  `GET /cashBalance/list` renvoie de même une seule ligne courante. Autrement dit, la trésorerie est
  **remise à plat à chaque session**, exactement comme les fills.
  → Corrige une idée reçue de notre côté : nous pensions que le P&L réalisé restait consultable
  après la clôture. Ce n'est pas le cas via l'API.

---

## 4. Historique et reporting

> ✅ **RÉSOLU (2026-09-26).** Le support NinjaTrader a confirmé le 23/09 que la Reporting API
> s'utilise avec notre jeton OAuth lecture seule. Vérifié sur comptes réels, prop firm compris, et
> **implémenté** (`TradovateReportingClient` + `TradovateHistoryService`). Le schéma exact, les
> pièges et les mesures sont en fin de section.

### Les serveurs `rpt-*` : non documentés

- **Aucune occurrence** de `rpt-live`, `rpt-demo`, `fill_history`, `position_history` ou
  `cash_history` dans les 464 pages de l'index Partner, ni dans la référence principale.
- Les hôtes **existent** pourtant : `https://rpt-demo.tradovateapi.com/v1/` et
  `https://rpt-live.tradovateapi.com/v1/` répondent (HTTP 404 sur la racine, donc le serveur est
  bien là, sans page à cet emplacement). Vérifié le 2026-09-20.
- Le serveur MCP officiel de la doc Partner, `https://partner.tradovate.com/_mcp/server`, n'expose
  **qu'un seul outil**, `searchDocs` (recherche documentaire). Il n'expose aucun outil d'historique.
  <https://partner.tradovate.com/> (section *How to Access the API*)
- Les outils `fill_history`, `position_history`, `cash_history`, `market_history` que nous
  connaissons viennent du **serveur MCP NinjaTrader** relié à nos sessions Claude (celui déclaré
  `ninjatrader-demo`), pas de la documentation publique. Ce serveur est actuellement **déconnecté**
  côté session (« invalid_token »), donc je n'ai pas pu lire ses définitions d'outils aujourd'hui.

**Conclusion sur `rpt-*` : chemin réel mais non documenté, donc non contractuel.** L'utiliser en
production nous exposerait à une rupture sans préavis. À valider directement avec le support
Tradovate / NinjaTrader avant toute dépendance.

### Le seul historique documenté : BigQuery, réservé aux partenaires

<https://partner.tradovate.com/resources/data-analytics/accessing-big-query-reports.md>

- Rapports quotidiens : **`daily-fills`**, `fraud-fills`, `account-status`, `all-accounts`,
  `cash-balance`, **`cash-history`**, **`position-history`**, `super-perf`, `users-with-same-ip`.
- Accès **réservé aux partenaires évaluation** : il faut contacter « Evaluation Support », indiquer
  les rapports voulus, et recevoir une **clé de compte de service** donnant un accès *read-only* au
  jeu de données BigQuery, ou une livraison CSV dans un bucket GCS.
- Cadence **quotidienne**, pas de temps réel.
- Portée : les comptes **de l'organisation partenaire**. Rien n'indique qu'un tiers comme nous, qui
  agit pour le compte d'un trader via OAuth, puisse y accéder.

### Dashboards admin

<https://partner.tradovate.com/resources/admin-dashboards/reports.md> — rapports et *query builder*
à l'usage des administrateurs d'organisation (interface, pas API tierce).

---

## 5. Données de marché et autres capacités

- **WebSocket temps réel** : `wss://{demo|live}.tradovateapi.com/v1/websocket`. Trames `o` (open),
  `h` (heartbeat), `a` (données), `c` (close). Le client doit envoyer `[]` **toutes les 2,5 s**,
  sinon le serveur coupe. Authentification une fois par connexion (`authorize`).
- **`user/syncrequest`** : abonnement aux changements d'entités de l'utilisateur (ordres, positions,
  fills…). Le champ `entityTypes` filtre « both the initial incoming dataset and the types of
  updates » ; **par défaut le tableau est vide**, donc presque aucun événement.
  <https://partner.tradovate.com/overview/core-concepts/web-sockets/user-syncrequest.md>
  La doc **ne dit pas** quelle profondeur temporelle contient l'instantané initial.
  **[terrain]** C'est ce canal qui déclenche nos synchros live.
- **Données de marché** : `md/subscribeQuote`, `md/subscribeDOM`, `md/subscribeHistogram`,
  `md/getChart` (barres Minute/Daily/Tick/Renko…, avec `timeRange`), `md/cancelChart`. Les graphiques
  acceptent une plage historique (`asFarAsTimestamp`, `asMuchAsElements`) — **l'historique existe
  donc pour les prix, pas pour les trades d'un compte**.
- **Contrats et instruments** : `contract/item`, `contract/find`, `contract/items`,
  `contractMaturity/*`, `product/find`, `currency/*`. C'est la table de correspondance
  `contractId → symbole` dont nous avons besoin pour nommer un trade.
- **Market Replay** : `wss://replay.tradovateapi.com/v1/websocket`, `replay/initializeclock`
  (`startTimestamp`, `speed`, `initialBalance`). Rejoue le marché, ne rejoue pas l'historique d'un
  compte réel.
- **Risque** : `userAccountPositionLimit/*`, `userAccountRiskParameter/*`, `accountRiskStatus/*`
  (lecture et écriture) — utile pour comprendre les règles prop firm, mais en écriture chez nous
  c'est hors de question.
- **Alertes, chat, configuration** : existent, sans intérêt pour un journal.

---

## 6. Lecture seule : ce qu'on peut, ce qu'on ne peut pas

### Accessible avec nos permissions actuelles (OAuth, lecture)

- la liste des comptes de l'utilisateur et leurs métadonnées (`/account/list`) ;
- le solde, le P&L ouvert et réalisé, la marge (`/cashBalance/getcashbalancesnapshot`) ;
- **la devise du compte** (`/cashBalance/list` → `currencyId`, puis `/currency/item`) ;
- les positions ouvertes (`/position/list`) ;
- les exécutions et appariements **de la session en cours** (`/fill/list`, `/fillPair/list`,
  `/fillFee/list`, `/executionReport/list`) ;
- les mouvements de trésorerie **de la session en cours** (`/cashBalanceLog/list`) — et rien
  au-delà, voir §3 ;
- les contrats, produits, devises (ContractLibrary) ;
- le temps réel des changements de l'utilisateur (`user/syncrequest`) ;
- les données de marché et les graphiques historiques.

### Hors de portée

- **L'historique des trades d'avant la connexion** : aucun endpoint REST documenté ne l'expose, et
  aucun ne prend de plage de dates. **[terrain]** Les entités des sessions closes ne reviennent plus.
- Les rapports **BigQuery** (`daily-fills`, `position-history`, `cash-history`) : réservés aux
  partenaires évaluation, sur demande, avec une clé de compte de service.
- Les serveurs `rpt-*` : non documentés, donc sans garantie ni contrat.
- Tout ce qui est écriture : passer un ordre, créer des comptes, modifier le risque — et nous n'en
  voulons pas.
- La création et la gestion des utilisateurs et comptes d'évaluation : réservé au partenaire prop
  firm (identifiants d'admin d'organisation, clé API, CID), pas à une app tierce en OAuth.

### Reconstituer l'historique d'un nouvel utilisateur à la connexion ?

**Non, pas avec la seule API REST documentée.** Les seuls chemins possibles :
1. **Import CSV** par l'utilisateur (ce que nous faisons déjà) ;
2. **rpt-\*** si Tradovate confirme leur existence, leur accès en OAuth et leur stabilité ;
3. **BigQuery** si nous devenons partenaire, ou si la prop firm nous délègue ses rapports ;
4. **Synchro continue** à partir de la connexion : on ne rattrape pas le passé, mais plus rien ne se
   perd ensuite.

---

## 7. Limites et pièges

- **Débit** : utilisateur authentifié 5 000 requêtes/heure, 5 000/minute, 5 000/seconde ; anonyme
  1 000/h, 1 000/min, 100/s. Dépassement → **429**, et la doc dit « Wait one hour before sending
  another request », « cannot be resolved programmatically from third-party applications ».
  <https://partner.tradovate.com/overview/core-concepts/rate-limits.md>
- **Tickets de pénalité** : certaines opérations renvoient un **HTTP 200** contenant `p-ticket`,
  `p-time`, `p-message`, et parfois `p-captcha: true` — dans ce dernier cas l'opération **ne peut
  plus être retentée depuis une app tierce**. `accesstokenrequest` est limité à **5 échecs/heure**.
  Le `p-ticket` est lié à l'IP et doit être renvoyé dans le corps de la requête suivante.
- **Deux sessions simultanées maximum** par utilisateur : une troisième ferme la plus ancienne, et
  les jetons de la session fermée produisent ensuite des 408/429/500. Ne jamais redemander un jeton
  quand on peut renouveler.
- **Expiration** : 80 à 90 minutes selon la page ; renouveler bien avant (MTC : 40 min, cf. plus bas).
  **[terrain]** Tradovate **fait tourner** le refresh token à chaque renouvellement : deux
  renouvellements simultanés invalident l'un des deux, d'où notre verrou par connexion.
- ⚠️ **Le refresh token ne vit PAS 14 jours.** La doc annonce `refresh_token_expires_in`
  1 209 600 s (14 j) *dans son exemple*. **Mesuré en prod le 2026-09-22** sur les 5 connexions d'un
  utilisateur réel : la valeur réellement renvoyée est **≈ 26 h**, et elle n'est même pas honorée.
- ⚠️ **`HTTP 200` + `{"error":"invalid_token"}` ≠ token mort.** Le refus du grant `refresh_token`
  n'arrive pas en 401 mais en **200 avec un corps d'erreur** — un client qui teste `res.ok` ne le
  voit pas. Et il est **souvent transitoire** : mesuré en prod, Tradovate a refusé un refresh token
  **jamais utilisé, émis 1 h 50 plus tôt**, qu'il déclarait lui-même valide 26 h ; la même connexion
  s'est renouvelée sans problème le lendemain. **Ne jamais condamner une connexion sur un refus
  unique** (bug du 2026-09-21 : 4 comptes passés à tort en « à reconnecter »).
- **Conséquence pour MTC** : on tente le refresh dès qu'un refresh token existe, sans se fier à
  `refreshTokenExpiresAt` ; un refus déclenche une 2ᵉ tentative espacée (avec relecture de la
  connexion, au cas où un autre worker aurait renouvelé) ; et « à reconnecter » n'est posé que si
  les deux tentatives échouent ET que le repli `renewaccesstoken` est indisponible ou refusé.
- **`items?ids=`** : la doc prévient déjà que « a number of loaded entities can be less than a
  number of IDs » et que l'ordre n'est pas garanti. **[terrain]** Au-delà d'une dizaine d'ids, c'est
  un 404 à corps vide : nous plafonnons les lots à 10 et préférons `/list`.
- **Pas de pagination** documentée sur les `/list` : on prend tout ce qui est « visible ».
- **Demo ≠ Live** : ce sont deux domaines, donc deux jeux d'entités et d'identifiants. Un compte
  d'évaluation prop firm est sur **demo**, même quand l'utilisateur se connecte avec un compte
  « live » chez sa firme. **[terrain]** L'OAuth ne fonctionne que côté Live (« Wrong client_id » en
  Demo) alors que les données se lisent côté Demo : les deux ne sont pas interchangeables.
- **Ordres automatisés** : `isAutomated: true` est obligatoire pour tout ordre passé par programme.
  Sans objet chez nous (aucune écriture), mais c'est une règle d'échange, pas un détail.
- **Fenêtres de maintenance** : <https://partner.tradovate.com/resources/reference/maintenance-windows.md>.
- **WebSocket** : sans battement toutes les 2,5 s, déconnexion. Un flux de données actif ne renvoie
  pas de battements côté serveur : c'est au client de tenir le rythme.

---

## 8. Réponse à notre besoin

**Non, la documentation Tradovate ne permet pas d'importer l'historique d'un trader prop firm
(demo) au moment où il connecte son compte.** Aucun endpoint REST documenté n'accepte de plage de
dates, et `fill`, `fillPair` et `executionReport` se limitent au « visible scope » de l'utilisateur,
que nos mesures réduisent à la session en cours. `cashBalanceLog` ne rattrape rien : mesuré le
2026-09-20, il ne contient que la ligne `NewSession` du jour.
Les deux seules voies crédibles sont **les rapports BigQuery** (`daily-fills`, `position-history`,
`cash-history`), réservés aux partenaires évaluation sur demande et livrés une fois par jour, et
**les serveurs `rpt-live` / `rpt-demo`**, qui existent mais ne sont documentés nulle part : à
confirmer avec le support avant d'en dépendre. En attendant, on garde l'import CSV pour le passé et
la synchro continue pour la suite.

---

## 9. Pistes de features non encore dans MTC (cartographie, rien de développé)

### Ce que l'app exploite déjà

`/account/list`, `/position/list` (seulement pour compter les positions ouvertes), `/fill/list`,
`/fillPair/list`, `/fillFee/list` et `/items`, `/contract/items`, `/contractMaturity/items`,
`/product/items`, l'OAuth et son renouvellement, plus la WebSocket temps réel (événements `props`).
Tout le reste de l'API est inexploité.

### Tests de permission réellement effectués

**Méthode** : sondage en lecture seule exécuté le **2026-09-20** dans le conteneur `mtc_api_beta`,
avec la connexion Tradovate de Val (compte **TDFY**, `externalAccountId` 649929xx (masqué), environnement
**demo**, hors séance). Le jeton a été renouvelé exactement comme le fait l'app (verrou Redis
`tradovate:sync:<id>`, rotation du refresh token persistée dans les mêmes colonnes). **Aucun ordre,
aucune modification de compte.**

| Endpoint testé | Résultat | Lecture |
|---|---|---|
| `POST /cashBalance/getcashbalancesnapshot` | **200** — `netLiq` 50 939,50 · `openPnL` 0 · `realizedPnL` 0 · marges 0 · `autoLiqLevel` 0 | ✅ accessible |
| `GET /cashBalance/list` | **200** — 1 ligne pour le compte, `currencyId: 1` | ✅ accessible |
| `GET /cashBalanceLog/list` · `/deps` | **200** — 1 seule ligne, type `NewSession`, datée du jour | ⚠️ accessible mais **limité à la session** |
| `GET /marginSnapshot/deps?masterid=` | **200** — 1 ligne | ✅ accessible |
| `GET /userAccountPositionLimit/deps?masterid=` | **401** (corps vide) | ❌ refusé |
| `GET /accountRiskStatus/list` | **401** (corps vide) | ❌ refusé |
| `GET /tradingPermission/deps?masterid=` | **401** (corps vide) | ❌ refusé |
| `GET /executionReport/list` · `/order/list` · `/orderVersion/list` · `/commandReport/list` | **200** — tableaux **vides** (hors séance) | ✅ permission OK, ⚠️ contenu à confirmer en séance |
| `GET /currency/item?id=1` · `/currency/list` | **200** — `{"id":1,"name":"USD","symbol":"$"}`, 14 devises | ✅ accessible |
| `GET /fill/list` · `/fillPair/list` · `/position/list` | **200** — tableaux vides hors séance | ✅ (portée session, cf. §3) |
| **WebSocket** `wss://md.tradovateapi.com/v1/websocket` : `authorize` | **200** | ✅ le jeton est accepté |
| **WebSocket** `md/subscribeQuote` (MNQZ6) | **401 « Access is denied »** | ❌ **cotations refusées** |

Deux enseignements structurants :
1. **Tout ce qui touche au risque et aux permissions du compte est fermé** à notre jeton OAuth
   (401). Seules les données de trésorerie, de marge, de trades et de contrats passent.
2. **Notre jeton est accepté par le serveur de données de marché, mais pas ses cotations.** Le refus
   porte sur l'abonnement aux données, pas sur l'authentification : c'est une question
   d'entitlement marché sur le compte, pas de scope OAuth.

### Les pistes, avec leur verdict

#### 🥇 Quick win n°1 — Le vrai solde du compte ✅ accessible

`POST /cashBalance/getcashbalancesnapshot` (+ `/cashBalance/list` pour la devise).
Aujourd'hui, le capital, l'equity et la marge de drawdown affichés par MTC sont **estimés à partir
des trades loggés**, avec un disclaimer. Le broker, lui, donne `netLiq`, `totalCashValue`,
`openPnL`, `realizedPnL`, `initialMargin`, `maintenanceMargin` et `autoLiqLevel`.
Effet : « Mes comptes » et le dashboard affichent le vrai solde ; l'écart entre notre estimation et
la réalité devient visible et explicable. Un appel de plus dans la synchro existante, plus un champ
en base. C'est le meilleur rapport valeur/effort, et c'est testé accessible.

#### 🥈 Le pari à moyen terme — Qualité d'exécution ✅ permission OK, contenu à confirmer

`executionReport`, `order`, `orderVersion`, `commandReport` répondent **200** avec notre jeton. Hors
séance, les tableaux sont vides : le contenu doit être confirmé **pendant que Val trade**, mais la
permission, elle, est acquise.
Ce que ça débloque, et qu'aucun journal manuel ne peut faire :
- le **slippage** réel (prix demandé contre `avgPx` obtenu) ;
- les **stops déplacés** en cours de trade, via l'historique des versions d'ordre : la trace
  factuelle de l'indiscipline, aujourd'hui invisible ;
- les ordres **annulés ou rejetés** (hésitation, erreurs de saisie) ;
- le délai ordre → exécution, et les entrées en plusieurs fois.

Contrainte identique aux fills : **portée session**, donc uniquement en synchro continue, jamais en
rattrapage. C'est la piste la plus différenciante à moyen terme, et la plus coûteuse à construire.

#### ❌ Règles prop firm lues chez le broker — refusé

`userAccountPositionLimit`, `userAccountRiskParameter`, `accountRiskStatus`, `tradingPermission`
répondent **401**. L'utilisateur continuera donc à saisir son objectif et son drawdown à la main.
Contournement possible, sans ces endpoints : échantillonner `netLiq` à chaque synchro pour
reconstituer **notre propre** courbe d'equity et un drawdown suiveur calculé sur des soldes réels
plutôt que sur des trades. C'est déjà nettement mieux que l'estimation actuelle.

#### ❌ Graphique du trade, MAE / MFE — refusé

`md/subscribeQuote` renvoie **401 « Access is denied »** alors que l'`authorize` passe. Sans
abonnement aux données de marché sur le compte, pas de cotations, donc pas de graphique du trade ni
de calcul du pire et du meilleur point atteint. À rouvrir seulement si Tradovate confirme qu'un
entitlement marché peut être associé à un compte d'évaluation.

#### ⚠️ Frais, resets et payouts — accessible, mais session seulement

`cashBalanceLog` expose `cashChangeType` (`Commission`, `Debit`, `FundTransaction`, `NewSession`…),
`delta` et `realizedPnL`. Testé : **une seule ligne**, celle de la session du jour. Un suivi
« coût réel du mois », resets d'évaluation et payouts compris, n'est donc possible **que si nous
capturons ces lignes au fil de l'eau** et les stockons chez nous. Faisable, mais ce n'est pas une
lecture d'historique : c'est une accumulation à partir d'aujourd'hui.

#### ✅ Positions ouvertes en direct — accessible

`position/list` (déjà appelé, mais seulement compté) plus `openPnL` du snapshot : l'écran Session
live peut montrer la position en cours, son prix moyen et son résultat latent, et alerter sur une
taille inhabituelle. Sans cotations, le P&L latent vient du broker, pas d'un calcul de notre côté.

#### ✅ Comptes proposés automatiquement — accessible

`account/list` donne nom, type et état de chaque compte. Aujourd'hui l'utilisateur crée ses comptes
à la main avant de les relier ; on pourrait lui proposer directement ses comptes Tradovate, avec le
bon libellé et la bonne devise (`currencyId` résolu via `/currency/item`).

#### ✅ Deux petites choses — accessibles

- **Frais détaillés** : `fillFee` sépare clearing, bourse, NFA, courtage, commission et routage.
  Nous ne stockons qu'un total : un écran « d'où viennent mes frais » coûte peu.
- **Échéances** : `contractMaturity` (déjà appelé) porte la date d'expiration, donc une alerte de
  roulement avant que le trader se retrouve sur la mauvaise échéance.

### Ordre de priorité proposé

1. **Vrai solde** (testé ✅) — quick win, réutilise la synchro.
2. **Positions ouvertes en direct** + **comptes proposés automatiquement** (testés ✅) — petits
   ajouts, effet immédiat à l'écran.
3. **Qualité d'exécution** (permission ✅) — le vrai différenciateur, à confirmer en séance.
4. **Courbe d'equity maison à partir de `netLiq`** — remplace les règles prop firm refusées.
5. **Frais, resets et payouts** — seulement en accumulation continue.
6. **Graphique du trade** — bloqué tant que les cotations sont refusées.


---

## 10. Reporting API — schéma réel et import de l'historique

Reconstitué le 2026-09-26 en lisant les messages d'erreur du serveur : **rien n'est documenté**.

```http
POST https://rpt-{demo|live}.tradovateapi.com/v1/reports/requestReport
{
  "name": "Performance",
  "representationType": "csv",
  "timezone": 0,
  "params": [
    { "name": "startDate", "value": "9/1/2026" },
    { "name": "endDate",   "value": "9/26/2026" },
    { "name": "account",   "value": "APEX4280470000012" }
  ]
}
```

**Quatre pièges**, chacun silencieux ou trompeur :

| Piège | Symptôme |
|---|---|
| `timezone` doit être un **nombre** | `Invalid JSON: illegal number` |
| dates en **`M/D/YYYY`** | l'ISO `2026-09-26` renvoie **HTTP 500** |
| `params` est un **tableau** de `{name, value}` | `expected '[' or null` |
| `account` = le **NOM** du compte | `account is not found (ID:0)` avec l'id |

**Et une règle de performance** : toujours passer `account`. Sans lui, Position History met 43 s,
Account Balance History 60 s, Cash History dépasse 120 s et expire. Avec lui : **150 à 270 ms**.

- **Synchrone** : la réponse porte `{ "data": "<csv>" }`. Ni identifiant de tâche, ni attente.
- **Fenêtre maximale** : 63 jours passent, 92 sont refusés (`Too long range`) → découpage mensuel.
- **Authentification réelle** : jeton bidon → `401 Access is denied`. Un jeton expiré donne
  `Expired Access Token` — message différent, à ne pas confondre.
- **CSV avec guillemets** : `"123,714.00"` — un `split(',')` naïf découpe faux.

### ⚠️ Les frais viennent de `Fills`, pas de `Cash History`

L'import CSV manuel relie une commission à son fill par la convention **`txnId − 1 = fillId`**.
**Elle ne tient pas.** Mesuré le 2026-09-26 sur un compte réel : **0 correspondance sur 291**, avec
un décalage variable d'une ligne à l'autre (−2 n'en rattrapait que 117). Un import qui s'y fierait
produirait un P&L **brut** en silence — la fusion « réussit » en n'attribuant rien.

Le rapport **`Fills`** porte le `Fill ID` **et** sa `commission` : jointure exacte, vérifiée
**291/291 et au centime** (266,40 $). C'est lui que l'import historique utilise.

### Pourquoi l'import a tenu en si peu de code

Le CSV de `Performance` est **byte-compatible** avec l'export que l'import CSV sait déjà lire :
même en-tête (`buyFillId` / `sellFillId` déclenchent la détection `tradovate`), mêmes index de
colonnes, même P&L comptable `$(8.50)` déjà géré par `parseTradovatePnl`. Et `Cash History`
correspond au fichier de frais attendu (`Transaction ID` / `Delta` / `Cash Change Type`), avec les
mêmes libellés `Commission` et `Trade Paired`, et la même convention `txnId − 1 = fillId`.

L'import ne réécrit donc **aucun mapping** : il passe par `CsvImportService` puis
`TradesService.importTrades` — même dédup, y compris inter-sources (CSV sans fuseau ↔ API en UTC),
donc aucun doublon avec les trades déjà remontés par la synchro live.

⏳ **Importer tôt** : Tradovate archive un compte inactif ou en échec au bout de 10 jours, et son
historique devient alors illisible. D'où le déclenchement dès la connexion, sans attendre.

### Jusqu'où remonte l'historique ? (mesuré le 2026-09-26)

La question posée était « on ne peut pas récupérer plus de 6 mois ? ». Réponse : **les 6 mois
étaient notre constante, pas une limite de Tradovate**. La seule contrainte de l'API est la
*largeur* d'une fenêtre (au-delà de ~63 jours : `Too long range`) — et on interroge mois par mois.

Sonde en lecture seule sur un compte prop firm réel, 24 fenêtres mensuelles :

```
2026-09 :  33 trades     2026-06 → 2026-01 : 0
2026-08 : 244 trades     (rien avant le premier trade réel)
2026-07 :  17 trades
```

**`/account/list` et `/account/item` portent un champ `timestamp` = date de création du compte**
(non documenté). Sur les 3 comptes du login testé : `2026-02-12T14:11:13Z`, `2026-02-12T17:18:52Z`,
`2026-08-31T13:55:56Z`. C'est la borne basse de l'import : plus besoin de deviner une profondeur.

Le piège que ça révèle : ce compte a été **créé en février et n'a tradé qu'en juillet**, soit cinq
mois vides consécutifs. L'ancien arrêt « 2 mois vides d'affilée » aurait tronqué l'historique à mai
*en annonçant l'avoir tout remonté*. Il n'est donc conservé qu'en repli, quand la date de création
est absente.

Restent non mesurés, faute de compte assez ancien : la rétention réelle de Tradovate au-delà de
3 mois de données, et l'archivage à 10 jours d'un compte inactif (documenté, jamais vérifié).
