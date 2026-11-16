# Synchro broker par API (PROMPT-207, Tradovate / NinjaTrader)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Synchro broker par API — pattern (PROMPT-207, Tradovate / NinjaTrader) · 2026-09-11 -->
> **Origine** : `nestjs.md` · « Synchro broker par API — pattern (PROMPT-207, Tradovate / NinjaTrader) » · 2026-09-11

## Synchro broker par API — pattern (PROMPT-207, Tradovate / NinjaTrader)

Premier broker synchronisé par **API** plutôt que par fichier. Module
`modules/integrations/tradovate/`. À reprendre tel quel pour Binance / Bybit.

**Règles réutilisables**
- **Une connexion = un `TradingAccount`** (`BrokerConnection`, `@@unique([accountId, provider])`),
  jamais au niveau `User` : chaque prop firm donne ses propres identifiants. Nouveau broker =
  nouvelle valeur de l'enum `BrokerProvider`, même table.
- **Secrets chiffrés** (`common/utils/token-cipher.util.ts`, AES-256-GCM, clé
  `BROKER_TOKEN_ENCRYPTION_KEY`), jamais renvoyés : les vues publiques (`toView`) excluent
  toute colonne `*Enc`. Pour une clé API Binance : même colonnes, même chiffrement.
- **Mapper PUR** (`tradovate-trade.mapper.ts`) : entités broker → `Partial<CreateTradeDto>`,
  sans I/O, testé unitairement. Puis **`TradesService.importTrades`** — jamais un
  `trade.create` direct : c'est lui qui porte la dédup `importHash` + contrainte
  d'unicité, le compte cible et le recalcul du barème comportemental.
  **Répétitions ≠ doublons** : deux lignes identiques d'une même source (fichier, synchro) sont
  deux trades — un trade à plusieurs contrats arrive souvent en plusieurs paires Tradovate de
  mêmes prix et même seconde de clôture. La n-ième prend l'empreinte `clé#n` (`occurrenceHash`) :
  réimporter la source ne recrée rien, une répétition manquante en base est créée. Le nettoyage
  des doublons (`GET/DELETE /trades/duplicates`) raisonne sur `importHash ?? clé` pour ne jamais
  supprimer une répétition légitime, et le rapprochement « même trade, autre fuseau »
  (`CrossSourcePool`, `trades/import-dedupe.util.ts`) se fait dans `importTrades` : écart nul
  exclu, un trade existant par ligne. Avant ce correctif, 5 des 28 paires de Val (14/09/2026)
  étaient écartées comme doublons. Un trade API doit avoir
  EXACTEMENT la forme d'un trade CSV du même broker (règles partagées dans
  `trades/tradovate-pair.util.ts`, utilisées par les DEUX chemins).
- **Dédoublonnage PAR COMPTE (#1001, décision du 15/11)** : un trade n'est un doublon que s'il existe
  déjà dans le compte où il va. Le même trade copié sur deux comptes (copy trading) = deux trades.
  `importTrades` résout le compte de chaque ligne comme `create` (`targetAccountId` : fourni → séance
  active → compte par défaut), puis applique empreinte, répétitions et rapprochements (autre fuseau,
  ancien P&L net MEXC, ancien arrondi) dans ce compte seulement (`AccountDedupeStates`,
  `trades/account-dedupe-state.ts`). Les trades sans compte comptent pour tous (0 en prod le 15/11).
  Empreinte stockée `a:<compte>|<clé>` (`accountImportHash`) : l'index `@@unique([userId, importHash])`
  ne change PAS (aucune migration) ; une empreinte d'avant #1001 (sans préfixe) reste reconnue au
  ré-import dans son compte (comparaison des champs). Les clés de position `tv:<fill>` restent sans
  préfixe. Résultat : `alsoInOtherAccounts` (`[{ accountId, name, count }]`), affiché par l'import CSV
  (« 12 trades existent aussi dans le compte « X » : importés ici aussi. »). « Supprimer les doublons »
  (`accountDuplicateIdentity`) compare dans un même compte, jamais d'un compte à l'autre.
  Tradovate (`assertNotMixingAccounts`) : un compte Tradovate déjà relié à un autre compte MTC du
  trader est refusé (`TRADOVATE_ACCOUNT_LINKED_ELSEWHERE`, N8) ; changer de compte Tradovate quand le
  compte MTC contient déjà des trades synchronisés est refusé (`TRADOVATE_ACCOUNT_HAS_OTHER_TRADES`,
  N7). Limite : après un compte disparu chez Tradovate (détaché), l'ancien n'est plus connu. Preuve :
  `import-par-compte.int-spec.ts`, `tradovate-select-account.spec.ts`.
  Empreintes d'avant #1001 : un trade importé puis MODIFIÉ ne se reconnaît plus à ses champs ; ses
  empreintes sans préfixe sont relues en base pour les clés du lot (`occurrenceHash(clé, 1..n)`) et
  restent prises dans LEUR compte (une empreinte d'un autre compte ne bloque rien).
  Un trade réaffecté garde l'empreinte de son compte d'origine : ré-importé dans l'ancien compte, il
  compte comme doublon (P2002), jamais recréé. Tout script de réparation qui réécrit `importHash` doit
  garder le préfixe (`accountImportHash(t.accountId, …)`) et chercher les collisions avec l'empreinte
  préfixée (les `empreinteLibre` des scripts #780 / #950 écrivent une empreinte sans préfixe).
- **Un trade Tradovate = une POSITION (#956, décision du 13/11)**, de l'ouverture au retour à plat,
  plus une paire de fills. `trades/tradovate-position-group.util.ts` (pur) regroupe les paires par
  le cumul net des exécutions, contrat par contrat, dans les TROIS chemins : synchro (mapper puis
  `groupTradovateTrades`, `leftovers: 'skip'`), rattrapage Reporting et import CSV de l'export
  Performance (`leftovers: 'pairs'`). Règles : quantité = somme des contrats, entrée et sortie
  moyennes pondérées, P&L et frais additionnés (frais posés par paire AVANT, fill de retournement au
  prorata), `tradedAt` = dernière clôture, stop/objectif de la première entrée (capture sur l'ordre
  du fill d'ouverture, `_openFillId`), R/R sur l'entrée moyenne. Retournement par une seule
  exécution = deux trades.
  - **Clé stable** `importHash = tv:<fill d'ouverture>` (`positionImportKey`), identique dans les
    trois sources : aucun doublon synchro ↔ CSV ↔ rapport, quel que soit le fuseau.
  - **Synchro** : aucun trade avant le retour à plat (anti-tilt et journal de risque réagissent à la
    clôture). Données de séance (`tradovate-position-input.ts`) : `prevPos`/`netPos` de la position,
    exécutions non appariées rattachées au compte par `order.accountId` (`/order/list` lue une fois,
    réutilisée par la capture du stop). Position ouverte la veille (`prevPos ≠ 0`) ou cumul ≠ `netPos`
    → paires mises de côté (`deferred` du résultat), reprises au retour à plat ou par le rattrapage.
  - **`importTrades`** : `_positionKey` déjà en base → doublon, ou mise à jour des champs du broker
    (`growPosition` : prix, quantité, P&L, frais, clôture, R/R, note d'exécution si stop, totaux de
    la séance clôturée) si la position a grandi — jamais stop, émotion, setup, notes. Une paire de la position déjà en base à l'ancien format (trade par
    paire, avant #956) → la position est importée **paire par paire** (`_pairs`), sans doublon,
    jusqu'à la réparation des trades existants. Métadonnées `_…` retirées par `withoutImportMeta`.
  - Événement `tradovate:trades` : `updated` en plus de `created` ; anti-tilt sur `created` seul.
  - Limite connue : une position à cheval sur deux mois est vue en deux morceaux par le rattrapage
    Reporting (une fenêtre par mois).
  - **Réparation des anciens trades (PR 2)** : `POST /api/admin/tradovate/repair-positions` (ADMIN,
    essai par défaut, `?apply=true` pour écrire, verrou Redis, réponse 202 et travail en arrière-plan),
    `GET …/repair-positions` (dernier rapport), `GET …/repair-positions/backup[?at=AAAAMMJJ-HHMM]`
    (JSONL des lignes AVANT fusion, une clé Redis datée par exécution appliquée, jamais réécrite,
    30 jours ; `backedUp` du rapport = nombre de lignes du fichier). Positions recalculées depuis la Reporting API (`recomputedWindows`, comme
    #783), plan pur `tradovate-positions-repair.ts` : toutes les paires retrouvées en base, aucune
    clé `tv:` déjà là, MÊMES saisies sur toutes les lignes (émotion, setup, stop, objectif, notes,
    tags, capital, unité de temps, séance) — sinon comptée (`incomplete` / `alreadyGrouped` /
    `conflicting`), jamais fusionnée. Ligne gardée = celle de la paire d'ouverture ; champs du broker
    recalculés depuis les lignes EN BASE (total P&L et frais inchangés). `TradesService.mergeImportedPosition` :
    transaction (alertes de comportement rattachées, lignes supprimées, R/R et note « stop » recalculés),
    puis `refreshAfterFeesRepair` par compte. Périmètre : connexions actives, non démo, compte non
    archivé ; lignes importées seulement (synchro, historique, CSV du compte connecté).
- **Client HTTP en lecture seule** (`tradovate-api.client.ts`) : que des GET de données + les
  appels d'auth. Aucune méthode d'écriture (ordre, risque) — contrat NinjaTrader.
- **Erreurs** : `TradovateException(code)` → message FR clair + `code` machine (relayé par
  `HttpExceptionFilter`, qui transmet désormais `code` s'il est présent). Jamais de réponse
  brute du broker, jamais de stack. **Aucun autre broker nommé** dans ces messages (clause 2.ii).
- **Verrou Redis** par connexion pendant la synchro (double-clic) ; Redis down → on continue,
  la contrainte d'unicité reste le filet.
- **Pas de PremiumGuard** : même règle que l'import CSV d'un broker connu (cf. `plans.md`).

**Quand les trades sont-ils récupérés ?** (PROMPT-217)

| Déclencheur | Séance en cours (Trade API) | Mois en cours (Reporting API) |
|---|---|---|
| Connexion d'un compte Tradovate | ✅ | ✅ **toute la vie du compte** |
| Ouverture de l'app (`catchUp`) | ✅ si > 1 min | ✅ **si > 30 min d'absence** |
| Trade en direct, app ouverte | ✅ ~1,5 s | ❌ |
| Cron de fond, toutes les 15 min | ✅ si > 12 min | ❌ |
| Cron de fond, 1er passage de l'heure | ✅ (sauf app ouverte) | ✅ **y compris app ouverte** |
| Bouton « Synchroniser » | ✅ | ✅ |
| Cron, 1er passage de l'heure, `historyImportedAt` vide | — | ✅ **toute la vie du compte**, ≤ 2 par passage |

**Profondeur de l'historique = la vie du compte, jamais une constante.** Tradovate date le compte
(`timestamp` sur `/account/list`, servi aussi par `/account/item` — non documenté, vérifié le
2026-09-26 sur 3 comptes prop firm). `depthFromCreation` en déduit le nombre de fenêtres
mensuelles ; l'appel existait déjà pour relire le nom du compte, donc zéro requête de plus.
Conséquences à connaître :

- L'arrêt « 2 mois vides d'affilée » ne s'applique **que** faute de date de création. Avec une
  date, il est désactivé — et ce n'est pas cosmétique : compte mesuré créé le 2026-02-12, premier
  trade en juillet, soit **5 mois vides entre les deux** que l'arrêt rendait inatteignables.
- Sans date exploitable (champ absent, ou postérieure à maintenant) → repli `HISTORY_FALLBACK_MONTHS`
  (6) **et** arrêt aux mois vides : c'est alors la seule borne disponible.
- `HISTORY_MAX_MONTHS` (60) est un garde-fou contre une date aberrante, pas une politique.
- **Une profondeur demandée est un contrat, jamais « corrigée ».** `{ months: 1 }` reste un mois,
  même sur une connexion qui n'a jamais eu son passé : cet appelant, c'est le bouton
  « Synchroniser », donc quelqu'un qui attend. 24 fenêtres = 11 s d'appels mesurés + l'écriture en
  base : un clic de 2 s deviendrait un clic de 30 s. **Une profondeur pleine ne se tire que là où
  personne n'attend** : à la connexion d'un compte (non attendu, `void` dans le callback OAuth) et
  dans le cron de fond.
- **`historyImportedAt` est l'état de ce rattrapage** : vide = le passé n'a jamais été remonté
  entièrement. Le cron (1er passage de l'heure) en traite au plus `FULL_BACKFILLS_PER_PASS` (2),
  ce qui étale un déploiement trouvant N connexions au lieu d'empiler N imports dans un passage et
  de chevaucher le suivant. Le marqueur n'est posé que par un import de profondeur pleine **et**
  si aucune fenêtre n'a échoué — sinon le trou ne serait plus jamais comblé.
- **Équité du budget (#856)** : la requête du cron est triée par `createdAt` (ordre stable), et les
  places vont d'abord aux connexions jamais tentées, puis aux moins récemment tentées (Redis
  `tradovate:backfill-tried:<connexion>`, posé dès l'attribution de la place, réussite ou non, TTL
  7 j). Deux connexions qui échouent toujours ne prennent plus les 2 places à chaque heure. Redis
  indisponible → ordre de création seul, le rattrapage continue.
- Un mois vide ne coûte qu'**un** appel (pas de rapport `Fills`), donc remonter loin est bon marché.
- **Frais de l'historique (#783)** : `Fills` (fills + horodatages) + `Cash History` (tous les frais),
  joints par `cashHistoryFeesByFill` (même règle que l'import CSV, cf. `instruments.md`). Cash History
  indisponible ou vide → repli sur la colonne `commission` de `Fills` (commission seule). 3 appels par
  mois non vide. Les trades importés avant le 31/10 n'avaient que la commission.
- **Réparation des frais (#783)** : `POST /api/admin/tradovate/repair-fees` (ADMIN, 202, essai par
  défaut, `?apply=true` pour écrire, 409 si une réparation tourne : verrou Redis 2 h) ; `GET` = dernier
  rapport (Redis, 14 j). `TradovateFeesRepairService` relit chaque connexion CONNECTED non démo via
  `TradovateHistoryService.recomputedWindows` (mêmes calculs que l'import, rien d'écrit), rapproche
  par `dedupeKey` (`planFeeRepairs`, un pour un) les trades `BROKER_HISTORY` / `CSV_IMPORT` du compte,
  et ne change QUE `commission`, à la hausse (trades reliés par un fill partagé : remis au prorata en
  groupe, total du groupe jamais baissé, #950) ; puis barème + cache analytics
  (`TradesService.refreshAfterFeesRepair`). Pas de détection d'incident relancée. Dans l'API et non en
  script : un script renouvellerait les jetons hors des verrous de connexion.

La raison d'être du rattrapage mensuel : **la Trade API ne montre que la séance ouverte et ne
rejoue JAMAIS une séance passée**. Tout ce qui est tradé pendant que l'API est arrêtée
(déploiement, panne) serait perdu définitivement. Le rapport mensuel, lui, le contient.
D'où aussi le seuil des 30 min à l'ouverture : c'est le filet d'auto-réparation après une panne
du worker cron — il suffit qu'un utilisateur ouvre l'app pour que son mois soit rattrapé.

⚠️ **Le cron saute la SÉANCE d'un utilisateur en direct, jamais son rattrapage mensuel.** Le
WebSocket ne fait que la séance, et le filtre de fraîcheur exclurait toujours un utilisateur
actif : sans traitement particulier, celui qui laisse l'app ouverte toute la journée serait le
SEUL à ne jamais recevoir le filet. Au 1er passage de l'heure, le cron interroge donc TOUTES les
connexions (aucun filtre de fraîcheur) et appelle directement `importForAccount` pour celles qui
sont en direct.

**Spécificités Tradovate (vérifiées)**
- OAuth **toujours sur Live** (`trader.tradovate.com/oauth`, `live.tradovateapi.com/auth/oauthtoken`,
  échange en `x-www-form-urlencoded`). Les **données** sont sur 2 hôtes : `live` (comptes réels)
  et `demo` (comptes simulés = comptes de prop firm). `account/list` est interrogé sur les deux,
  l'hôte est mémorisé par compte (`externalEnv`).
- Le token endpoint renvoie un **`refresh_token`** (non documenté) : renouvellement par
  `grant_type=refresh_token`, repli `GET /auth/renewaccesstoken`, sinon `NEEDS_RECONNECT`
  (409 `TRADOVATE_RECONNECT_REQUIRED`). Jamais de consentement toutes les 80 min.
- **Cycle de vie du token — règles issues du bug prod du 2026-09-21** (4 comptes d'un ambassadeur
  passés à tort en « à reconnecter », plusieurs fois par jour) :
  - **`REFRESH_MARGIN_MS` = 40 min**, pas 5. Le cron de fond passe toutes les **30 min** : une
    marge plus courte que la cadence n'est quasiment jamais dans la fenêtre, le refresh n'était
    donc tenté qu'une fois l'access token **déjà mort**. Or `renewaccesstoken` exige un access
    token vivant : expiré, il n'y a plus de filet. **Règle : marge > cadence du cron de fond.**
  - **Un refus de refresh ne condamne jamais une connexion.** `refreshWithRetry` réessaie une
    fois après 2 s, en **relisant la connexion** (un autre worker du cluster a pu renouveler
    entre-temps : son access token est alors pris tel quel, sans rappeler Tradovate).
    `NEEDS_RECONNECT` n'est posé que si **deux** refus ET repli renew indisponible ou refusé.
    « Renouvelé ailleurs » = refresh_token changé en base OU échéance de l'access token repoussée
    depuis la lecture (`renewedElsewhere`) — PAS un access token simplement loin de son échéance :
    le cron de maintien choisit sur l'échéance du refresh_token, et prenait un token inchangé pour
    un renouvellement (faux « déjà renouvelé ailleurs », prod 2026-10-05).
  - ⚠️ **Jamais d'objet `conn` périmé jusqu'au refresh** (correctif du 2026-10-05). `refreshWithRetry`
    **relit la connexion sous le verrou de login**, avant tout appel : déjà renouvelée (`renewedElsewhere`)
    → token relu, aucun appel ; sinon c'est le refresh_token RELU qui part. Cause : `refreshClosings`
    repassait l'objet lu au début de `sync()`, après la rotation faite par `run()` → refresh_token
    déjà remplacé présenté (refusé), et le token neuf refusé à son tour juste après (2 connexions
    prod perdues, refresh_token pourtant non échu — Tradovate semble révoquer la lignée sur
    réutilisation, non documenté). Tout appelant qui enchaîne plusieurs `getSession` après une
    étape qui a pu renouveler relit quand même la connexion (`topUpCurrentMonth`, `refreshClosings`).
  - ⚠️ **Refresh_token mort, renew vivant** (correctif du 2026-10-05 : 42 refus `invalid_token` en
    7 h sur 4 connexions prod). `renew` prolonge l'access token mais **ne fait pas tourner le
    refresh_token** : le token refusé restait en base et repartait 2 fois à chaque passage. Après
    deux refus + renew réussi → marqueur Redis `tradovate:refresh-dead:<id>` (6 h,
    `REFRESH_DEAD_RETRY_S`) portant l'**empreinte** du refresh_token : tant qu'il vaut, `renew`
    direct, refresh seulement si renew échoue (dernier recours). Un nouveau refresh_token (refresh
    réussi, propagation, reconnexion) l'invalide de fait. `refreshNow` rend alors **`renewed`**
    (« prolongé(s) sans refresh » dans le log du cron), plus `refreshed`.
  - ⚠️ **`refreshTokenExpiresAt` n'est pas une autorité pour TENTER.** Tradovate annonce ≈ 25 h
    (et non les 14 j de sa doc) puis refuse parfois le token bien avant. On tente dès qu'un refresh
    token existe.
  - **Mais c'est elle qui décide de CONDAMNER** (correctif du 2026-09-26, objectif produit : « connecté
    tant que l'utilisateur ne clique pas sur Déconnecter »). Refus + repli impossible alors que
    `refreshTokenExpiresAt` est dans le futur → `TRADOVATE_REFRESH_DEFERRED` (503, connexion gardée
    `CONNECTED`, retentée à chaque passage) ; `NEEDS_RECONNECT` seulement une fois l'échéance
    passée (ou inconnue). Une vraie révocation est donc constatée au plus ~25 h après.
  - ⚠️ **Pause de 10 min après un refus passager** (`REFUSAL_COOLDOWN_S`, clé Redis
    `tradovate:refresh-refused:<id>`) : pendant la pause, `getAccessToken` lève `REFRESH_DEFERRED`
    et `refreshNow` rend `retry` **sans appeler Tradovate**. Sans elle, le WebSocket (backoff
    plafonné à 60 s) redemandait un refresh deux fois par minute pendant des heures (beta,
    2026-09-26). Levée par tout renouvellement réussi ; ne masque jamais un refresh_token échu.
  - ⚠️ **Deux comptes MTC sur le MÊME login Tradovate** (vu en beta avec les comptes de test) :
    la propagation se limite au même user MTC, donc leurs copies s'invalident mutuellement quand
    l'une renouvelle. Cas marginal chez de vrais users ; ne pas étendre la propagation entre users
    sans décision explicite (ce serait partager des tokens entre comptes MTC).
  - Un **401 sur une lecture de données** (token pourtant frais) ne condamne plus : `lastSyncError`
    + 503. Seul `getAccessToken` décide de `NEEDS_RECONNECT`, et `markNeedsReconnect(id, cause)`
    **journalise la cause** (warn « → À RECONNECTER (…) »).
  - ⚠️ **Tickets de pénalité** (`tradovate-penalty.ts`, #852, #853, #854) : un 200 avec `p-ticket`,
    `p-time` ou `p-captcha` lève `TradovatePenaltyError` (kind `rate_limited`) dans les trois clients
    (`postToken`, `assertOk`, `fetchCsv`). Ce n'est **jamais** un refus de jeton ni un CSV vide.
    Clé Redis `tradovate:penalty:login:<login>` (`conn:<id>` si login inconnu), TTL = `p-time`, 1 h si
    absent, 24 h si captcha. Pendant la pause : `validToken` lève `TRADOVATE_PENALIZED` ou
    `TRADOVATE_CAPTCHA_REQUIRED` sans appel, `refreshNow` rend `retry`, `tryRevive` rend `false`.
    Statut et jetons intacts. Import : arrêt au mois pénalisé, `historyImportedAt` non posé, pas
    d'import en P&L brut ; clôtures et payouts : le curseur n'avance pas. Captcha : `lastSyncError`
    écrit sur le login. Journal d'une seule ligne, sans jeton, ticket ni identifiant : un nouveau
    `catch` Tradovate qui journalise un identifiant doit tester `isPenaltyFailure`. Le 429 sans
    ticket garde son traitement ordinaire. Redis indisponible : pas de pause.
  - ⚠️ **`HTTP 200` + `{"error":"invalid_token"}`** : le refus n'est pas un 401, et il est souvent
    **transitoire** (mesuré : refus d'un token jamais utilisé émis 1 h 50 plus tôt).
  - `TradovateTokenRefreshCron` (**toutes les heures** depuis le 2026-09-26, celles qui expirent
    sous 18 h) est le **seul** entretien d'un utilisateur dont l'app reste ouverte : le cron de fond
    le saute (`isLive`) et le WebSocket ne redemande un token qu'à sa réouverture. Il ne regarde
    jamais la présence. Il fait aussi la **seconde chance** : `NEEDS_RECONNECT` + refresh_token
    encore promis → `tryRevive` (refresh sous verrou de login ; accepté → `CONNECTED`).
  - **Portée LOGIN, pas connexion** (correctif du 2026-09-26). Tradovate fait tourner le
    refresh_token par **login** (`userId` Tradovate) ; un login porte souvent plusieurs comptes,
    donc plusieurs `BrokerConnection`, chacune avec SA copie des tokens. La première qui renouvelle
    invalide celle des autres — c'est ce qui tuait 2 des 5 connexions d'un ambassadeur.
    - `externalUserId` (colonne qui existait mais n'était **jamais écrite**) est posé au
      consentement, et **rattrapé** par la synchro via `rememberLogin` pour les connexions
      antérieures.
    - ⚠ **Le login, c'est `/user/list`, JAMAIS `account.userId`** (corrigé le 2026-09-27).
      `account.userId` est le **propriétaire du compte chez le broker** : sur un compte prop firm,
      c'est l'identifiant de la **firme**. Mesuré en prod : deux traders Apex sans aucun lien
      (`APEX_10000` et `APEX_200000`, e-mails différents) portaient tous deux `userId: 699523`, et
      `/user/item?id=699523` répondait **404** — ce n'est pas un trader. Tant qu'on écrivait cette
      valeur, **tous les traders Apex de la plateforme partageaient le verrou
      `tradovate:login:699523`** (goulot latent), et « sœur » voulait dire « compte chez la même
      firme ». `discoverLogin` lit donc `/user/list` (un seul élément, son `id`) ; échec ou réponse
      vide → login `null`, verrou par connexion, aucune propagation : dégradé, jamais bloquant.
    - **Un compte broker ne se relie qu'à UN seul compte MTC.** `dropAlreadyLinked` écarte, au
      consentement, tout compte déjà relié par un **autre utilisateur** MTC : il n'est pas offert
      à l'écran de sélection, son nombre part dans le retour (`excluded=N`, message côté front),
      et si c'était le seul, le retour est `reason=account_already_linked`. `selectAccount` refuse explicitement
      (`TRADOVATE_ACCOUNT_ALREADY_LINKED`) — l'utilisateur a désigné ce compte, il doit savoir
      pourquoi. Sans filtre de statut : une connexion « à reconnecter » garde son refresh_token et
      le cron peut la ressusciter, donc elle reste un voleur en sommeil. Contrepartie assumée : un
      compte abandonné par un autre utilisateur doit être délié chez lui, ce que dit le message.
      Le même utilisateur qui se reconnecte n'est jamais bloqué (`userId: { not: userId }`).
    - `selectAccount` **ne retouche pas** `externalUserId` : changer de compte ne change pas
      l'utilisateur authentifié, et y écrire `target.userId` réintroduirait l'identifiant de firme.
    - `rememberLogin` reçoit désormais **tous** les comptes du `/account/list` comme fratrie (ils
      appartiennent par construction à l'utilisateur de ce jeton), au lieu de les filtrer sur
      `account.userId`. La synchro n'appelle `/user/list` que si le login manque encore.
    - Verrou `tradovate:login:<externalUserId>` (TTL 30 s) autour du SEUL renouvellement — distinct
      du verrou de synchro `tradovate:sync:<id>` (TTL 120 s), pour que deux comptes d'un même login
      puissent continuer à se synchroniser en parallèle.
    - Verrou déjà pris → on attend puis on relit : la sœur a propagé, son access token est en base.
      Si elle n'a rien donné, on tente quand même (jamais bloqué par un verrou).
    - Après un renouvellement réussi, `propagateToSiblings` écrit les nouveaux tokens sur toutes les
      connexions du même login **et les repasse `CONNECTED`** : une sœur condamnée par une rotation
      concurrente l'avait été à tort, le login vient de répondre.
    - Sans `externalUserId`, aucune propagation : on ne devine pas les liens de parenté.
  - Détail cluster : en prod l'API tourne en **3 workers** (`WEB_CONCURRENCY`, défaut), seul le worker 0 porte
    `IS_CRON_WORKER=true` (`main.ts`, `cluster.fork`). `docker exec printenv IS_CRON_WORKER`
    répond « absent » — il lit l'env du conteneur, pas celui du worker. Vérifier via
    `/proc/<pid>/environ` avant de conclure qu'aucun cron ne tourne.
- **Verrou partagé synchro + cron** (`tryLock` / `unlock` du service de connexion, clé
  `tradovate:sync:<id>`) : deux renouvellements concurrents présenteraient un refresh_token
  déjà remplacé et marqueraient à tort la connexion « à reconnecter ».
- **Callback hors `/api`** (exclu dans `main.ts`) : le redirect_uri enregistré est
  `https://<api>/integrations/tradovate/callback`. Ne pas le déplacer sans mettre à jour
  l'inscription OAuth côté Tradovate.
- **`state` signé + cookie httpOnly** (`mtc_tradovate_oauth`, SameSite=Lax, path du callback).
  Le cookie est **obligatoire** au callback : sans lui, un tiers pourrait faire consentir une
  victime avec SON lien et recevoir les trades de la victime. La doc ne dit pas si Tradovate
  renvoie `state` : s'il le renvoie, il doit égaler le cookie. Le callback journalise « state renvoyé = oui/non » (#1004) : quand la prod montre « oui », exiger `state` (un cookie d'une tentative abandonnée vit 10 min et laisse passer un code tiers sans `state`). Côté front, l'appel `authorize`
  doit partir **avec credentials** pour que le cookie soit posé.
- **Jamais de choix d'office à la première connexion** (#332, 2026-10-03) : même avec UN seul
  compte, `saveConnection` laisse `externalAccountId` vide → `select_account`, et rien n'est
  importé avant que l'utilisateur confirme (mauvais login, compte voisin écarté). Seule une
  **reconnexion** garde le compte déjà choisi (→ `connected` + première synchro). Le premier
  `POST …/select` d'une connexion sans `historyImportedAt` lance l'historique complet en fond
  (`TradovateHistoryService.launchFullImport`, comme le callback) ; le front enchaîne `sync`.
- **Retour au point de départ** (PROMPT-208) : l'origine (`wizard` | `settings`) est signée
  dans le `state`. Sur `connected` (reconnexion), le callback lance une **première synchro**
  (jamais bloquante : échec → `sync=error`, la connexion reste faite) puis redirige : wizard → `/dashboard?…&from=wizard`
  (l'overlay d'onboarding s'y rouvre), réglages → `/accounts?…`. Query params : `tradovate`
  (`connected`|`select_account`|`error`), `accountId`, `reason`, `trades`, `fees`
  (`ok`|`partial`|`none`), `sync`, `from`, `excluded` (comptes écartés, absent si 0). Un `state` illisible renvoie vers les réglages,
  jamais sur une page morte.
- Chaîne de lecture : `position/list` (seul lien fill → compte) → `fillPair/list` (paires =
  lignes de l'export Performance) → `fill/list` + `fillFee/list` (fills et frais exacts de la
  séance, filtrés sur les paires ; un id absent est relu par `fill/items` / `fillFee/items`)
  → `contract` / `contractMaturity` / `product` (symbole, `valuePerPoint`).
- ⚠ **Lots `/xxx/items` : 10 ids maximum.** Au-delà, Tradovate répond 404 à corps vide alors que
  chaque entité existe (mesuré sur le compte de Val le 14/09/2026 : 1, 2 et 10 ids passent,
  41 → 404). À 100 par lot, la synchro d'un compte actif échouait entièrement. Un fill
  introuvable n'ignore que sa paire (`skipped`), jamais toute la synchro.
- **Un 404 de lecture n'est pas « compte introuvable »** : `TradovateApiError('not_found')`
  → `TRADOVATE_UNAVAILABLE`.
- **Compte absent de `account/list` ≠ déconnexion** (bug prod du 2026-09-26 : un compte prop firm
  de Val a disparu de son login pendant la maintenance du week-end, le token marchait toujours,
  l'app lui disait « reconnecte-toi »). `handleMissingAccount` :
  - présent sur l'**autre hôte** → `externalEnv` corrigé, la synchro continue ;
  - absent depuis moins de `ACCOUNT_GONE_GRACE_MS` (2 h) **comptées depuis la première absence
    constatée** (#855, Redis `tradovate:account-missing:<connexion>`, TTL 48 h, effacé au
    détachement ; une synchro réussie après cette date la remet à zéro) →
    `TRADOVATE_ACCOUNT_TEMPORARILY_MISSING` (503), rien de détaché. Avant #855, le délai partait de
    la dernière synchro réussie : après une panne de plus de 2 h, une seule absence détachait.
    Redis indisponible → on patiente, jamais de détachement ;
  - absent durablement → connexion **détachée** (`externalAccountId/Env/Name = null`, reste
    `CONNECTED`), `availableAccounts` relu sur les 2 hôtes, `TRADOVATE_ACCOUNT_NOT_FOUND` (« choisis
    le compte à synchroniser »). Le front affiche le sélecteur : `needsAccountSelection` vaut
    désormais `!externalAccountId && available.length >= 1` (même avec un seul compte restant :
    on ne verse jamais les trades d'un autre compte broker sans le demander). `selectAccount`
    efface `lastSyncError`.
- P&L = **brut** `(vente − achat) × qty × valuePerPoint`, frais dans `commission` (comme le CSV).
  `tradedAt` tronqué à la seconde (granularité de l'export).
- **Rapprochement CSV ↔ API** : l'export Performance est en heure LOCALE sans fuseau, parsée
  dans le fuseau du serveur (`TZ=Europe/Paris` en beta). L'empreinte exacte ne coïncide donc
  pas ; `isCrossSourceDuplicate` reconnaît le même trade décalé d'un nombre entier de
  demi-heures (≤ 14 h), mêmes prix, même P&L. Appliqué par `importTrades` dans les DEUX sens :
  CSV importé avant la synchro, ou après (avant le 14/09/2026, seul le premier sens était
  couvert : un CSV importé après la synchro recréait les trades en double si le Tradovate de
  l'utilisateur n'affichait pas l'heure du serveur).
- ✅ **Profondeur d'historique : résolue** par la Reporting API, bornée par la date de création du
  compte (cf. plus haut). Mesuré le 2026-09-26 : la sonde remonte jusqu'à 24 mois et ne renvoie
  rien avant le premier trade réel — la profondeur servie est donc tout ce que le compte contient.
  Reste non testé : un compte de plus de 3 mois d'ancienneté de données, et l'archivage à 10 jours
  d'un compte inactif (documenté, jamais vérifié) après quoi l'historique devient illisible.
- ⚠ **Profondeur d'historique non garantie (Trade API)** : l'API REST pourrait ne renvoyer que les
  positions / paires récentes. À mesurer en beta sur un vrai compte ; si c'est le cas, un
  import CSV reste nécessaire pour le passé et la synchro sert au fil de l'eau.
  (Vérifié : la synchro n'envoie AUCUNE borne de date — `position/list` et `fillPair/list` n'ont
  pas de paramètre ; test « première synchro : tout l'historique » dans `tradovate-sync.int-spec`.)
  **Mesuré le 2026-09-12 (samedi, PROMPT-212)** : sur 2 logins réels (4 comptes prop firm),
  `position/list`, `fillPair/list`, `fill/list` et `order/list` renvoient 0 entité alors que
  l'utilisateur avait tradé avant la connexion → très probablement, ces routes n'exposent que la
  séance en cours. À confirmer un jour de bourse. Chaque synchro logue désormais ce que Tradovate
  a RENVOYÉ (`describeTradovateSnapshot` : comptes, positions du compte / des autres comptes du
  login, séances, paires rattachées ou orphelines, fills lus) — jamais de prix ni de P&L.

**Temps réel (PROMPT-210 live) — calé sur la PRÉSENCE dans l'app**
- Canal applicatif `/tradovate-live` (`tradovate-live.gateway.ts`, même pattern que `/eco`) mais
  **authentifié** : JWT de l'app dans `handshake.auth.token`, vérifié par `JwtService`
  (`AuthModule` importé) ; invalide ou `isDemo` → `disconnect(true)`. Room `user:<id>`.
- `TradovateLiveService` : 1er client d'un user sur le worker → **rattrapage REST** (la synchro
  existante, sautée si `lastSyncAt` < 60 s) puis **un WebSocket Tradovate par compte connecté**.
  Dernier client parti → WebSockets fermés (1000). Rien ne tourne app fermée, SAUF veille serveur.
- **Veille serveur (#770, 2026-10-26)** : dernier onglet fermé, trader éligible → le worker
  titulaire du bail GARDE le WebSocket, et les alertes du gateway (prop firm, anti-tilt,
  comportement) partent en push app fermée (émission vers une room vide : les services d'alertes
  et le push ne changent pas). Plan : `docs/audit-push-veille-serveur.md`.
  - Allumée seulement si push des traders actif ET `TRADOVATE_WATCH_MAX` > 0 (`config/tradovate-watch-config.ts`,
    absente = **éteinte**). Éligibilité (`tradovate-watch.ts`, PUR) : pas démo, `isPremiumAccess`,
    ≥ 1 `UserPushDevice`, `PROP_RULES` ou `BEHAVIOR` non coupé, séance ouverte du jour, ≥ 1 connexion
    suivable (`TRACKABLE_CONNECTION`). Heures silencieuses → `paused` (WS fermé, veille gardée,
    rouvert après). Fin : 10 h max, jamais après la journée de trading (17:00 Chicago).
  - Registre Redis `tradovate:watch` (ZSET, score = fin ms), plafonné à `TRADOVATE_WATCH_MAX`
    (`TradovateWatchService`). Un aller-retour dans l'app ne repousse pas la fin.
  - `sweepWatch()` toutes les 30 s sur les process `web`/`all` (pas le worker de crons) : WS tenu
    sans onglet fermé si veille finie, en pause, ou bail tenu ailleurs ; veille sans titulaire
    (déploiement blue/green, crash) **reprise** avec rattrapage (trades du trou, sans anti-tilt).
    Arrêt du process : WS fermé et bail rendu, registre intact. Clôture de séance → fin ≤ 30 s
    (pas de branchement dans `SessionService`).
  - En veille, le chemin des alertes est le « direct » : journal de séance (#373), incident `live`
    (#669), marqueur « affichée » posé (pas de bandeau à la réouverture : le push l'a portée). La
    synchro de fond voit `isLive` vrai et saute la séance.
  - `GET /push/settings` → `liveWhileClosed` (push actif ET veille allumée) : le texte du délai suit.
- Rattrapages **bornés à `LIVE_CATCH_UP_CONCURRENCY` (5) par process** (`createLimiter`,
  `common/utils/concurrency.util.ts`, SCA-B6-02) : après un redémarrage, tous les clients reviennent
  en même temps ; les suivants attendent leur tour (le WebSocket, lui, s'ouvre sans attendre).
- **Un seul WebSocket par user, tous workers et onglets confondus** : bail Redis
  `tradovate:live:<userId>` (SET NX PX 30 s, renouvelé / rendu par script Lua « si c'est le
  mien »). Worker titulaire sans clients → il rend le bail, un autre reprend ≤ 10 s. Redis down →
  on laisse passer (au pire 1 WS par worker). `isLive(userId)` = le bail existe.
- `tradovate-live.connection.ts` : `authorize\n0\n\n<token>` (même access_token que le REST,
  pris **sous le verrou `tradovate:sync:<id>`** : rotation du refresh_token), puis
  `user/syncrequest` `{ accounts: [id], entityTypes: ['fill','fillPair','position'] }`
  (`entityTypes` obligatoire), heartbeat `[]` / 2,5 s. Coupure → backoff 1 s → 60 s ;
  `shutdown ConnectionQuotaReached` → 5 min ; jeton irrécupérable → abandon + événement
  `tradovate:status` (le bouton manuel reste le filet).
- **Aucun trade créé depuis l'événement** : `props` utile → regroupement 1,5 s →
  `TradovateSyncService.sync` (mapper, frais, dédup, verrou). `SYNC_IN_PROGRESS` → 3 essais / 3 s.
  Trades créés → `tradovate:trades { accountId, created, duplicates, total, source }`.
- **Hôtes dynamiques (`apiHosts`, correctif du 2026-10-02, #286)** : JAMAIS d'hôte Tradovate en
  dur. REST, WebSocket et reporting se construisent via `tradovate-hosts.ts` (`restBase`, `wsUrl`,
  `reportingBase`) à partir de `BrokerConnection.apiHosts` (hôtes nus : `live`, `demo`,
  `reportingLive`, `reportingDemo`…). L'hôte `demo` est propre à l'organisation (prop firm) et a
  changé le 2026-10-03 : hôte périmé = WS `421` définitif, REST `307`. `/auth/oauthtoken` ne
  renvoie PAS `apiHosts` → lu par `renewAccessToken` à la connexion (`exchangeWithHosts`), puis
  relu dès qu'il a plus de 30 min (`API_HOSTS_TTL_MS`) dans `TradovateTokenManager.getSession`,
  et diffusé aux connexions sœurs. Tout appel prend `getSession(conn)` → `{ token, apiHosts }`
  (pas `conn.apiHosts` en mémoire, possiblement périmé). Le WS relit son URL à chaque reconnexion.
  Repli : constantes historiques (`FALLBACK_HOSTS`) ; filet REST : `fetchFollowingRedirect` suit
  une 307/308 https en gardant `Authorization`. WebSocket natif Node 22 (`LIVE_SOCKET_FACTORY`).
  Connexion OAuth sur hôte demo dédié verrouillée de bout en bout (vrai client, `fetch` simulé)
  par `tradovate-oauth-hosts.spec.ts` : `renewAccessToken` avant `/account/list`, liste sur l'hôte
  dédié, hôte dédié et jeton renouvelé enregistrés.
- **WS refusé avant ouverture (`421`, correctif du 2026-10-28)** : sur Node 22, une poignée de main
  refusée émet `error` **sans `close`** (readyState bloqué à CONNECTING, mesuré). `TradovateLiveConnection`
  traite donc un `error` avant toute trame comme une fermeture : socket abandonnée, puis
  `onHandshakeRefused` → `TradovateLiveService.forgetHosts` remet `apiHostsAt` à null AVANT la
  reconnexion, qui relit ainsi `apiHosts` sans attendre le TTL de 30 min. Un `error` après ouverture
  ne fait rien (le `close` qui suit relance). **Une seule invalidation par série d'échecs**
  (`hostsForgotten`, remis à false par une autorisation 200) : Node ne donne pas le statut, un
  refus réseau / 401 / 503 ressemble à un 421, donc refus persistant = 1 `renewAccessToken` et
  1 écriture par compte, puis backoff seul (1 s → 60 s) ; N comptes = N appels d'auth par série. Verrouillé par `tradovate-live.connection.spec.ts` et
  `tradovate-live.service.spec.ts` (« hôtes en cache »).
- **Limites documentées** : 50 connexions WebSocket simultanées **par user Tradovate**, 15
  appareils, `shutdown ConnectionQuotaReached`. **Aucune limite par `cid` / application
  documentée** → à confirmer avec NinjaTrader avant la montée en charge prod (pas bloquant à
  2-3 users de test).
- Filet de fond `TradovateBackgroundRefreshCron` (`7,37 * * * *` Paris, worker cron) : connexions
  sans synchro depuis 25 min, **users dont l'app est ouverte sautés** (le WebSocket s'en charge),
  démo exclus. Sert le récap journalier / Weekly Debrief, jamais le temps réel.
- Limite connue : un compte connecté PENDANT que l'app est ouverte n'est suivi en direct qu'à la
  prochaine ouverture (liste des connexions lue à l'arrivée du 1er client).

<!-- Origine : angular.md · Connexion broker par compte — pattern (PROMPT-208, Tradovate) · 2026-09-12 -->
> **Origine** : `angular.md` · « Connexion broker par compte — pattern (PROMPT-208, Tradovate) » · 2026-09-12

## Connexion broker par compte — pattern (PROMPT-208, Tradovate)

Réutilisable pour tout broker synchronisé par API (cf. `nestjs.md` pour le back).

- **Un compte = une connexion.** L'état vit dans `TradovateStore` (root) : `connections`,
  `byAccount` (Map accountId → connexion), et **par compte** `busy` (`sync` | `select` |
  `disconnect`) et `feedback` (lignes + erreur). Deux comptes (Apex + Lucid) ne se bloquent
  jamais l'un l'autre. Le wizard et « Mes comptes » partagent ce store.
- **Écran de réassurance AVANT de quitter l'app** (`mtc-tradovate-connect-modal`, palier
  z-index 1000 pour passer au-dessus de l'overlay d'onboarding) : compte cible, 3 étapes,
  encadré lecture seule (icône Lucide `Lock`, pas l'emoji). Rien n'est créé avant le retour
  de Tradovate : fermer l'onglet en cours de route ne laisse aucun demi-état.
- **Le cookie de `state` exige `withCredentials`** sur l'appel `authorize` (l'intercepteur
  le pose déjà partout ; `TradovateApi.authorize` le redemande explicitement).
- **Retour OAuth** : tout ce qui se lit et s'affiche est dans
  `core/utils/tradovate-return.util.ts` (pur, testé) : `parseTradovateReturn`,
  `tradovateErrorMessage`, `tradesLine`, `feesLine`, `syncResultLines`, `relativeTime`,
  `excludedAccountsMessage` (comptes du login écartés car reliés à un autre compte MTC).
  Sélecteur `mtc-tradovate-account-picker` : compte unique présélectionné et texte « rien n'est
  importé avant ta confirmation » ; plusieurs comptes → aucun présélectionné.
  - `from=wizard` → lu par l'**onboarding** dans `window.location.search`, APRÈS
    `restoreProgress()` : réussite → étape 9 avec le récap (classe `ob-import-recap`, comme le
    CSV) ; échec → étape 8 + message non bloquant (« tu peux réessayer ou importer un CSV ») ;
    `select_account` (toute première connexion, même à compte unique) → sélecteur à l'étape 8,
    avec `excludedAccountsMessage` si `excluded > 0`. **Jamais l'étape 1**, même si le localStorage a
    disparu.
  - sinon → lu par « Mes comptes » (`router.routerState.snapshot.root.queryParams`).
  - Dans les deux cas, paramètres retirés aussitôt : `router.navigate([], { queryParams:
    {…: null}, queryParamsHandling: 'merge', replaceUrl: true })` — commandes vides = même
    chemin, et un rechargement ne rejoue pas le message.
- **Après une synchro qui crée des trades** : `SelectedAccountStore.load()` +
  `TradesStore.reset()`, sinon dashboard et métriques restent sur l'ancien cache.
- **Pastille d'état « Mes comptes », par priorité** : `À reconnecter` (`NEEDS_RECONNECT`, message
  en sous-ligne) · `En pause` (`syncPaused`, texte de pause) · `● Synchro en erreur` (#857 :
  `syncFailed(conn)` = `CONNECTED` + `lastSyncError`, hors choix du compte et hors pause ; pastille
  `warn` jaune, message de l'API tel quel en sous-ligne `tradovate-sync-error-<id>`, dernière
  synchro et actions gardées) · `● Connecté`. Pendant le choix du compte, la pastille reste
  « Connecté » et l'erreur s'affiche au-dessus du sélecteur. L'erreur disparaît d'elle-même :
  l'API vide `lastSyncError` à la synchro réussie suivante.
- **Déconnexion** : confirmation en ligne (pas de `confirm()` natif), `404` = déjà
  déconnecté = succès. Le bouton reste rendu **pendant le choix du compte**
  (`needsAccountSelection`) : c'est la seule sortie après un mauvais login Tradovate.
  Si `brokerTradesCount > 0`, la confirmation affiche le nombre puis deux choix
  (garder = défaut, en premier · supprimer les seuls trades importés, `?deleteTrades=true`).
  `tradesDeleted: null` = connexion coupée mais suppression échouée → toast d'avertissement
  qui renvoie vers le journal, jamais de rollback de la déconnexion.
- **Synchro = option principale, CSV = repli (PROMPT-211).** Dans `csv-import`, source
  « Tradovate » hors onboarding (`allowFeesFile()`) → encart `import-tradovate-reco` d'abord
  (connecter → `mtc-tradovate-connect-modal` origin `settings` pour le compte choisi ; déjà
  connecté → `TradovateStore.sync`, résultat émis par `imported` comme un import), puis lien
  discret « ou importer un fichier CSV Tradovate » (`tvCsvOpen`) qui déroule les deux fichiers.
  Chaque ouverture repart sur la reco. Onboarding (`allowFeesFile=false`) et « Autre broker »
  inchangés. Wizard étape 8 : carte Tradovate en tête pleine largeur (`choice-featured`, accent
  `--nt`), CSV / manuel / zéro au second plan. Verrouillé par `csv-import-tradovate-*.spec.ts`.
- **Temps réel (PROMPT-210 live)** : `TradovateLiveSocketService` (root, socket.io
  `/tradovate-live`). Connecté par le **shell** (`SidebarComponent`, effet
  `isAuthenticated && !isDemo`), pas par l'écran Session live : app ouverte = connecté, logout /
  onglet fermé = coupé. `auth` est une FONCTION (jeton relu à chaque reconnexion) ; rejet
  serveur (`io server disconnect`) → nouvel essai espacé 2 s → 60 s. Échec = silence, le
  bouton « Synchroniser » reste le filet. `tradovate:trades` → toast, `SelectedAccountStore` +
  `TradovateStore` rechargés, `SessionStore.refreshLive()` si session ouverte (Live feed), puis
  `imported$` : journal et dashboard s'y abonnent pour se recharger.
- **Clause 2.ii NinjaTrader** : aucun autre broker nommé dans ces écrans et messages
  (verrouillé par `tradovate-return.util.spec.ts`). Aucun bouton ne suggère un ordre.
- **Tests sur le VRAI template** : `import TEMPLATE from './x.component.html?raw'` puis
  `overrideComponent({ set: { template: TEMPLATE, imports: [pipes nécessaires], schemas:
  [NO_ERRORS_SCHEMA] } })`. **Pas `node:fs`** dans un spec jsdom : sous l'exécuteur nx
  (`pnpm nx test`, celui de la CI), `node:path` est externalisé et le fichier entier échoue
  sans message, alors que `vitest run` direct passe. Les entrées signal (`input()`) ne
  s'alimentent pas en JIT : remplacer `cmp.accountId = signal(…)` avant le premier
  `detectChanges()`.
