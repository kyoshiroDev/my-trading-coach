# Audit #667 : contrat de session (les règles que le trader se fixe)

Date : 2026-11-28. Base : `origin/dev` `cff3be2f` (après #671). Tri du relecteur (26/11) : **B, audit + maquette + modèle/API**.

## Ce qui existe

- **Séance** : `TradeSession` (`prisma/schema.prisma:360`) n'a que l'humeur, des notes (`planNote`…) et les totaux.
  Pas de règle ni d'objectif par séance. Démarrage : `POST /session/start` (`CreateSessionDto` : `mood`, `accountId`),
  édition : `PATCH /session/:id` (`UpdateSessionDto` : `planNote`, `marketContext`, `notes`, `reflectionNote`, `moodEnd`).
- **Profil** (`User`, `schema.prisma:93-101`) : `tradesPerDayMin/Max`, `newsShieldMinutes` (#670 : null = 5, 0 = coupé,
  1 à 30), `tradingAssets[]`, `favoriteAsset`. Aucune perte max perso, aucun seuil de pertes d'affilée.
- **Règles de la firm** : par la phase du plan (`behavior-plan.ts` : `maxContractsAt`, `dailyLossLimitAt` ;
  `accounts/daily-loss.ts` : `metrics.dailyLoss { limit, used }`, Premium).
- **Moteur behavior** (`behavior-detectors.ts`, fonctions pures sur `EntryContext`, à chaque NOUVELLE ENTRÉE Tradovate) :
  C1 pertes d'affilée (seuil fixe 3, muet en apprentissage), C2 au-delà de `tradesPerDayMax`, D1 fenêtre d'annonce
  (avant l'annonce seulement, `newsShieldMinutes`), A2/A3 perte du jour vs limite de la FIRM. Appelé seulement pour une
  connexion Tradovate (`check`, `behavior-alerts.service.ts:99-104`) : **les trades saisis à la main n'y passent pas**.
  Envoi `behavior:alert` derrière `BEHAVIOR_ALERTS_UI` (éteint) + Premium ; D1 a son propre envoi `news:alert`.
- **Front** : pré-session `session-morning` (humeur, note de plan, objectifs HEBDO de l'IA évalués par
  `objective-check.util.ts`), Session live (`session-live`, affiche déjà `tradesMax` du profil), débrief de séance
  dans `today-session.component.html` (humeur de fin, meilleur / pire trade, émotions, « Objectifs du matin »).

## Écarts avec le ticket

1. Aucun stockage d'un contrat par séance, ni de trace de modification.
2. Pas de perte max perso, pas de seuil de pertes d'affilée réglable, pas de règle d'actifs autorisés.
3. Le bouclier annonces ne regarde qu'avant l'annonce (le ticket dit « autour »).
4. Le moteur ne tourne que sur Tradovate ; le contrat doit aussi valoir pour une séance saisie à la main.
5. L'anti-spam du moteur est par type et 15 min, pas « une fois par règle et par séance ».
6. Le débrief de séance ne montre ni règle, ni infraction, ni P&L après infraction.

## Plan proposé

### Principe : une seule évaluation, pure et partagée

`libs/shared/src/session-contract.ts` (pur, sans Angular ni Nest) :
`evaluateContract(contract, trades, events?)` → par règle : `respected | breached | not_applicable`, l'instant de
l'infraction (le trade qui la franchit), et ce qui a suivi (nombre de trades et P&L net après l'infraction, devise du
compte, `netPnl` + `roundCents`, comme `alertAftermath` #671). Utilisée par :
- le **front** pour le suivi en direct (barre de la Session live) et l'alerte au premier dépassement, pour une séance
  Tradovate comme manuelle ;
- l'**API** pour le débrief de séance (`GET /session/history/:id` et `today`) ;
- le **moteur** : les seuils du contrat remplacent ceux du profil comme ENTRÉES de C1 (pertes d'affilée), C2 (trades
  max) et D1 (minutes d'annonce) quand la séance a un contrat.

**Aucun doublon** (correction du relecteur) : les primitives sont écrites UNE fois dans `@mtc/shared` (série de pertes
avec `isLoss`, comptage des trades, test « dans la fenêtre d'une annonce », `assetCurrencies` déplacé ou réexporté,
jamais copié) et appelées par `behavior-detectors.ts`, `debrief-news-window.ts` et `evaluateContract`. Un spec montre
que C1 et l'évaluation du contrat donnent le même résultat sur la même série. Les deux règles sans équivalent moteur
(perte max perso, actifs) n'existent que dans `evaluateContract`.

**Règle en vigueur** : chaque trade est jugé sur la règle en vigueur à son heure, reconstituée depuis `edits` ;
desserrer une règle après l'infraction ne l'efface pas.

### Modèle (migration additive)

Table `SessionContract` (1 par séance) :
`sessionId @id` (cascade), `userId` (cascade, index), `maxDailyLoss Float?` (montant positif, devise du compte),
`maxConsecutiveLosses Int?`, `maxTrades Int?`, `newsMinutes Int?`, `allowedAssets String[]` (vide = tous),
`edits Json @default("[]")` (trace : `{ at, field, from, to }`), `createdAt`, `updatedAt`.
Null = règle non fixée. Pas de doublon de `tradesPerDayMax` : il sert de valeur par défaut au premier contrat.

### API

- `POST /session/start` : `contract?` optionnel dans le DTO (validé, bornes) ; enregistré avec la séance.
- `GET /session/contract/defaults?accountId` : préremplissage = contrat de la dernière séance du compte, sinon profil
  (`tradesPerDayMax`, `newsShieldMinutes`, `tradingAssets`) ; signale chaque limite plus large que la firm
  (`dailyLossLimitAt` de la phase : perte max perso > limite firm → `looserThanFirm`).
- `PATCH /session/:id/contract` : séance ACTIVE seulement, chaque changement ajouté à `edits`.
- Débrief : `getSessionDetail` et `today` renvoient `contract` + `evaluation` (calculée à la lecture, rien de stocké).
- Démo : `DemoReadOnlyGuard` bloque déjà les mutations ; seed : un contrat sur les séances démo, dont une infraction.

### Front (après la maquette)

Pré-session : bloc « Mon contrat » replié, prérempli, 5 champs, < 30 s, avertissement si plus large que la firm
(« la règle de la firm reste celle qui compte », mention « estimation MyTradingCoach »). Session live : état de chaque
règle dans la barre collante ou juste dessous, alerte in-app une fois par règle et par séance, contrat modifiable.
Débrief : règles respectées / enfreintes, heure, P&L après l'infraction, trace des modifications.

### Interrupteur

`SESSION_CONTRACT_ENABLED` (éteint par défaut), lu côté API et exposé au front par une réponse authentifiée (comme
`/behavior/config`) : rien de visible tant qu'il est éteint.

## Choix ouverts (proposition)

1. **Périmètre de cette PR** (tri « B ») : audit + maquette + modèle + API + évaluation partagée et seed démo, derrière
   l'interrupteur ; l'interface (pré-session, live, débrief) dans un ticket de suite après validation de la maquette ?
   Proposition : oui.
2. **Gating** : saisie et suivi en direct gratuits (discipline de base, comme le bouclier annonces #670) ; débrief des
   infractions avec P&L Premium (comme le débrief). À Greg (décision de plan).
3. **« Autour d'une annonce »** : règle du contrat sur la fenêtre T−X à T+X (comme la stat de #670) pour le débrief ;
   l'alerte en direct reste celle du bouclier (avant l'annonce). Proposition : oui.
4. **Alerte « une fois par règle et par séance »** : côté front par l'évaluation partagée (marche aussi en manuel) ;
   pas de nouvel envoi serveur, pas de push dans ce ticket (#666 : plus tard). Proposition : oui.
5. **Infraction** : la règle est enfreinte au trade qui la franchit (trades max : le N+1ᵉ ; pertes d'affilée : la
   N+1ᵉ entrée après N pertes, comme C1 ; perte max : le trade qui fait passer le P&L net réalisé sous −X ; actifs :
   un trade hors liste ; annonce : `tradedAt` dans [T−X, T+X] d'une annonce à fort impact sur les devises de l'actif,
   même prédicat que la stat #670 : `Trade` n'a pas d'heure d'entrée, seulement `tradedAt`). « P&L après » = trades clôturés après ce
   trade, celui-ci exclu.
6. **Perte max perso** : montant dans la devise du compte (pas en %) ; comparaison avec la limite de la firm seulement
   si le plan en a une.
7. **Seuil C1** : quand le contrat fixe `maxConsecutiveLosses`, C1 l'utilise et sonne aussi en apprentissage (la règle
   vient du trader, comme C2) ; sans contrat, inchangé (3, muet en apprentissage).

## Fichiers prévus

`prisma/schema.prisma` + migration ; `libs/shared/src/session-contract.ts` (+ spec, export index) et
`contracts/session.ts` ; `modules/session/` (DTO, service, contrôleur, int-spec) ; `modules/behavior/behavior-alerts.service.ts`
(seuils du contrat) ; `modules/admin/demo-data/session-contract-example.ts` + `demo-seed.ts` ;
`.claude/reference/` (routes, détecteurs, schéma, gating) ; maquette locale `maquettes/mockup-contrat-session.html`.

## Tranché par le relecteur (2026-11-28)

Choix 1 à 7 : oui, avec les corrections ci-dessus (primitives partagées, règle des annonces sur `tradedAt`, règle en
vigueur reconstituée depuis `edits`). Ordre : maquette (design puis relecteur) AVANT le modèle et l'API. Gating :
provisoirement **tout gratuit** (compagnon de séance, données du trader sans IA, précédent #670), sans `PremiumGuard`,
validation par Greg. Ajouts : `PATCH` en upsert sur une séance ACTIVE, `edits` plafonné à 50 ; bornes du DTO
(`maxDailyLoss` ]0 ; 10 000 000], `maxConsecutiveLosses` 1-20, `maxTrades` 1-100, `newsMinutes` 1-30, `allowedAssets`
≤ 20 de ≤ 20 caractères en majuscules) ; compte et séance vérifiés au propriétaire ; flag éteint = routes en 404,
`contract` ignoré au `start`, rien au débrief. Interface : ticket de suite ; quand la séance a un contrat, l'alerte du
contrat remplace le bandeau #671 de C1 et C2 (jamais deux alertes pour la même règle).

