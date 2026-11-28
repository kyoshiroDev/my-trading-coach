# Détecteurs de comportement (#602)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18) · 2026-10-18 -->
> **Origine** : `nestjs.md` · « Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18) » · 2026-10-18

## Détecteurs de comportement (#602, phase 1 : moteur + mode silencieux, 2026-10-18)

Module `modules/behavior/`. **Rien n'est affiché** tant que Greg n'a pas validé les chiffres du rejeu
(`docs/rapport-detecteurs-silencieux.md`). Méthode et limites : `docs/audit-detecteurs-comportement.md`.

- **Principe** : ne jamais prendre un style pour du tilt. B, C1 et C3 comparent le trader **à
  lui-même** (référence personnelle), B exige **au moins 2 signaux**. A (règles du plan) et C2
  (limite déclarée `tradesPerDayMax`) ont des seuils fixes parce que la règle vient d'ailleurs.
- **Tous les seuils** dans `behavior.constants.ts`, documentés. Pas de seuil ailleurs.
- **Lignes → positions** (`behavior-positions.ts`) : un `Trade` importé est une PAIRE de fills ; une
  ligne prolonge la position précédente (même compte / actif / sens) si elle sort dans les 2 s ou
  partage un prix d'entrée. Séance du moteur = **compte × journée CME** (`tradingDay`), pas
  `TradeSession` (rarement rattachée aux trades synchronisés).
- **Référence** (`behavior-baseline.ts`, pur) : 20 dernières séances CLÔTURÉES, persistée dans
  `BehaviorBaseline` par `BehaviorBaselineService` : cron `10 17 * * 1-5` Chicago (après
  `SessionCloseCron`, traders des dernières 26 h, hors démo) + recalcul à la volée si datée d'une
  journée précédente. Apprentissage : < 10 séances → B, C1, C3 muets.
- **Détecteurs** (`behavior-detectors.ts`, purs, aucun appel IA) : A1 taille > max du plan (micros
  ramenés en minis si mélange), A2 points défavorables avant la perte max du jour (seuils par actif),
  A3 entrée avec > 50 % de la perte max consommée, B vengeance, C1 3 pertes d'affilée, C2 au-delà de
  `tradesPerDayMax`, C3 taille ≥ 2× la perte précédente du même actif. Anti-spam : même type ≤ 1 fois
  / 15 min / séance. **Messages factuels** : décrire, jamais conseiller (AMF), pas de tiret cadratin.
- **Règles du plan** (`behavior-plan.ts`) : phase selon le type de compte, palier de max de contrats
  selon le profit, perte max via `dailyLossLimitAmount`. Sans plan relié au catalogue, A est muet.
- **En direct** (`BehaviorAlertsService`) : branché dans `tradovate-live.gateway.ts` sur
  `tradovate:balance` (émis après chaque synchro live, donc chaque fill / position), regroupé 1,5 s par
  compte, worker titulaire. Nouvelle entrée = position Redis (`tradovate:positions:<connexion>`)
  absente, retournée ou renforcée par rapport au dernier état vu (`behavior:pos:<compte>`, 12 h) ;
  premier relevé = mémorisé sans alerte. Perte max du jour et solde lus dans `AccountsService.list`
  (rien recalculé). Anti-spam partagé : `behavior:spam:<compte>:<journée>:<type>` (SET NX PX 15 min).
  Alerte **enregistrée** (`BehaviorAlert`) ; événement `behavior:alert` seulement si
  `BEHAVIOR_ALERTS_UI=true`. `BEHAVIOR_ALERTS_RECORD=false` coupe tout. Aucun appel Tradovate en
  plus, aucune synchro relancée. Hors démo. Rien ne tourne app fermée.
- ⚠️ **Heure d'entrée absente en base** (`tradedAt` = clôture) : au rejeu, l'entrée est datée de la
  première sortie (comme la référence) ; en direct, de l'ouverture Tradovate, comparée à une
  référence mesurée de sortie à sortie → biais vers plus d'alertes B en direct. Correctif proposé :
  `Trade.openedAt` (non fait).
- ⚠️ **Recoupement avec l'anti-tilt #371** (`tilt-detection.ts`, affiché, seuils fixes ligne par
  ligne) : laissé tel quel en phase 1. Si les détecteurs sont validés, l'UI de phase 2 le remplace.
- **Rejeu** : `apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts` (lecture de fichiers
  exportés en lecture seule et pseudonymisés, requêtes en annexe du rapport ; jamais de connexion à
  la base). `behavior-replay.ts` (pur) : référence de chaque séance sur les journées précédentes
  seulement, verrouillé par `behavior-replay.spec.ts`.

<!-- Origine : prisma.md · Détecteurs de comportement (#602, phase 1, 2026-10-18) · 2026-10-18 -->
> **Origine** : `prisma.md` · « Détecteurs de comportement (#602, phase 1, 2026-10-18) » · 2026-10-18

## Détecteurs de comportement (#602, phase 1, 2026-10-18)

- `BehaviorBaseline` (migration `20261018120000_behavior_baseline`, table nouvelle, additive) : une
  ligne par utilisateur (`userId` = PK, cascade), `sessionsUsed`, `throughDay` (`DATE`), `data` Json
  = `BehaviorBaselineData` (`modules/behavior/behavior-baseline.ts` : délais entre positions, taille
  médiane / p75 / p90 par actif, positions par séance). Table dédiée plutôt qu'un Json sur `User` :
  `User` est lu à chaque requête authentifiée et la référence a son propre cycle (recalcul à la
  bascule CME, à la volée si datée d'une journée précédente). Rien à ajouter au seed démo : la démo
  n'enregistre pas d'alertes (lecture seule, pas de synchro live). Exceptions : D1 (#670) et E1 (#672) ont
  chacun une alerte d'exemple dans le seed (`demo-data/news-shield-example.ts`, `demo-data/stop-widened-example.ts`).
- `BehaviorAlert` (migration `20261018130000_behavior_alert`, table nouvelle, additive) : alerte de
  comportement enregistrée en direct, **en silence** en phase 1. `userId` (cascade), `accountId`
  (cascade), `tradeDay` (`DATE`, journée CME = séance du moteur avec le compte), `sessionId`
  (`TradeSession`, SetNull, souvent vide : les trades synchronisés sont rarement rattachés à une
  session), `tradeId` (SetNull, vide en direct : le trade n'existe qu'à la sortie), `type` /
  `severity` en TEXT (liste dans `behavior-detectors.ts`), `message`, `context` Json, `dismissedAt`,
  `mutedByUser` (prévus pour l'UI de phase 2). Index `(userId, createdAt)`, `(accountId, tradeDay)`.
  Volume attendu ≈ 1 alerte par séance de trader actif : conservation à décider avant la phase 2
  (`RETENTION_RULES`).

## Bouclier annonces (#670, 2026-11-23)

Détecteur **`D1_NEWS_WINDOW`** (`behavior-news.ts`, calcul pur partagé) : position ouverte, ou qui s'ouvre,
moins de X minutes avant une annonce **à fort impact** (`EcoEvent.impact = 'high'`, heure de Paris
convertie par `parisWallTimeToUtc`) d'une devise de l'actif (`assetCurrencies`, `eco-calendar.briefing.ts`).
Message factuel : « NFP dans 4 min, position ouverte sur NQ. » (libellé `nameFr`, sinon nom FMP sans
« (Sep) »). X = `User.newsShieldMinutes` (null = 5, 0 = coupé, 1 à 30), réglé dans Profil, modale stratégie.
- **Seule exception à la phase silencieuse** (décision de Greg du 2026-11-23) : D1 est **affiché tout de
  suite**, hors `BEHAVIOR_ALERTS_UI`, par l'événement `news:alert` (toast `PropAlertsService.handleNews`)
  et le push `TraderNotifier` (titre « Annonce à venir ») ; enregistré aussi dans `BehaviorAlert` pour #671.
  Les autres détecteurs restent silencieux.
- Deux déclencheurs, un pipeline (`NewsShieldService.record`) : à l'entrée (`BehaviorAlertsService.check`,
  D1 sort du chemin générique) et **avant l'annonce** par un minuteur de 60 s dans `TradovateLiveGateway`
  sur le worker qui tient le WebSocket (`TradovateLiveService.ownedConnections`, bail détenu = positions
  Redis à jour). Anti-spam atomique `SET NX` (6 h) sur `behavior:news:<compte>:<créneau>`, partagé entre
  les deux déclencheurs et entre workers. Annonces relues au plus une fois par minute ; aucune annonce dans
  30 min = sortie sans lire Redis ; réglages et `isDemo` en une requête groupée. App fermée : seulement si la
  veille serveur (#770, Premium) garde le WebSocket.
- Coupe-circuit **`NEWS_SHIELD_ENABLED`** (`true` seulement, absente = coupé) : allumé sur dev au merge,
  en prod par Greg après vérification sur dev.
- Gating : alerte en séance gratuite ; stat du débrief Premium (avec le Weekly Debrief).
- Débrief : `WeeklyDebrief.stats.newsWindow` (`debrief-news-window.ts`, pur, sans IA, hors prompt IA),
  **par compte** (`{ windowMinutes, accounts: [{ accountId, inside, outside }] }`) : trades dont `tradedAt`
  (clôture pour un trade synchronisé) tombe de X min avant à X min après une annonce forte de leurs
  devises, contre le reste du compte : nombre, P&L net, taux de réussite. Fenêtre du trader, défaut si
  coupé. Absente si aucun trade clôturé ou en cas d'échec (le débrief se génère quand même). L'app montre
  deux lignes par compte ayant au moins un trade autour d'une annonce, P&L par `pnlFormat` avec
  l'`accountId` (devise du compte, #947), et masque le bloc sinon.
- Démo : trade NQ à 14:27 le vendredi précédent (3 min avant le NFP du faux vendredi), alerte D1 et stat
  dans le débrief de la semaine (`demo-data/news-shield-example.ts`).

## Jauge de pression (#1270, étape 1 : étude, 2026-11-27)

**Rien n'est affiché ni enregistré** : étude seulement, rapport `docs/audit-1270.md`. Les étapes 2 à 4
(calcul en direct, Session live, débrief) attendent les décisions de Greg listées dans le rapport.

- `behavior-pressure.ts` (pur) : `pressureAt(ctx: EntryContext)` à chaque nouvelle entrée, score
  0 à 100, états `calm` (< 30), `watch`, `red` (≥ 60), et `learning` (neutre) tant que la référence
  est en apprentissage. Signaux : ré-entrée après une perte (délai / délai médian du trader après une
  perte), taille > p90 (majorée juste après une perte), rang au-delà du p90 de positions par séance,
  pertes d'affilée, perte max du jour consommée, A1 et C2 (règles qui viennent d'ailleurs). Points et
  seuils dans `behavior.constants.ts` (section « Jauge de pression »). Phrase factuelle = les deux
  signaux les plus lourds ; jamais « émotion », jamais de tiret cadratin.
- `replay` renvoie `pressure[]` (une lecture par position, même index) ; `evaluatePressure` (pur,
  `behavior-pressure-eval.ts`) mesure le pouvoir prédictif : par état, P&L de la position et de la
  suite de la séance, pire position ; par séance, pires journées vues en zone rouge avant leur plus bas.
- `scripts/replay-pressure.ts` : `--demo` (jeu démo en mémoire, date figée, aucune base) ou dossier
  d'export pseudonymisé au format #602. Un export prod ne se fait qu'avec l'accord de Greg.

## E1 stop éloigné (#672, 2026-11-28)

Détecteur **`E1_STOP_WIDENED`**, silencieux comme A, B, C (`BEHAVIOR_ALERTS_UI`). Rapport : `docs/audit-672.md`.
- Déclenché par le WebSocket Tradovate, pas à l'entrée : `TradovateLiveService.onOrder` compare l'ancienne et la
  nouvelle version d'un ordre stop (`stopVersionChange`, avant `applyOrderVersion`), puis
  `BehaviorAlertsService.onStopMoved` lit la position du contrat en Redis (aucun appel Tradovate en plus).
- Règle (`behavior-stop.ts`, pur) : stop de sortie qui s'éloigne de l'entrée en finissant du côté perte, d'au moins
  `E1_MIN_TICKS` (2) ; ticks par `getTickSize`. **Pas de condition sur le latent** : il n'est pas connu au moment où le
  stop bouge (écart avec le ticket tranché par le relecteur, `decisions.md`). Rapprocher, rester côté gain ou un stop
  d'entrée : rien.
- Une fois par position : `behavior:stop:<compte>:<contrat>:<ouverture>` (SET NX, 12 h). Message factuel « Stop éloigné
  de 6 ticks sur NQ (risque porté à 14 ticks). », severity `medium` (gravité à fixer à #671). Hors démo, aucune action
  sur l'ordre (lecture seule, contrat NinjaTrader).

## Phase 2 : affichage (#671, 2026-11-28)

Tout derrière **`BEHAVIOR_ALERTS_UI`** (`behavior-flags.ts`, `true` seulement ; éteint par défaut). Plan : `docs/audit-alertes-comportement.md`.
- **Envoi** (`BehaviorAlertsService`, `audience`) : une alerte enregistrée part vers l'app (socket `behavior:alert`) et en push
  seulement si le flag est allumé, si le trader a l'accès Premium (`subscriptionState().premiumAccess`) et s'il n'a pas coupé ce
  détecteur ; sinon elle est enregistrée en silence (`mutedByUser` pour un détecteur coupé). E1 reçoit le push comme les autres.
- **« Pas pour mon style »** : table `BehaviorDetectorMute (userId, detector)`, routes `GET/POST /behavior/mutes`,
  `DELETE /behavior/mutes/:detector` (Premium, 404 flag éteint, mutations bloquées en démo). Détecteurs coupables :
  `BEHAVIOR_MUTABLE_DETECTORS` (`@mtc/shared`), D1 exclu (réglage propre `newsShieldMinutes`).
- **Configuration** : `GET /behavior/config` `{ uiEnabled }`, authentifiée (401 sans jeton), sans Premium (teaser). Choisie plutôt
  que `/auth/me` : la réponse de `UsersService` (profil) a son propre `select` et ferait disparaître un champ ajouté à `toMe`.
- **Historique** : `GET /behavior/alerts?from&to` (31 jours au plus) : alertes de la période, comme le Débrief hebdo hors
  comptes échoués et archivés, et pour chacune les trades clôturés du même compte jusqu'à l'alerte suivante, dans la même
  journée CME (`alertAftermath`, pur) : nombre, P&L net dans la devise du compte.
- **Anti-tilt #371** : flag allumé, `TiltAlertsService` n'envoie plus ni toast ni push (journal `tilt` gardé), sauf le
  surtrading relatif quand le trader n'a pas déclaré de limite (`tradesPerDayMax` absent ou 0) (C2 ne couvre que la limite déclarée) ; flag éteint,
  inchangé. Jamais deux alertes pour la même chose. Retrait des fichiers : ticket de suite, après l'activation en prod.
- **Types « signal »** (`BEHAVIOR_SIGNAL_TYPES`) : `F1_EMOTION_AFTER_LOSS` (« Revenge » ou « Peur » saisi à la main moins de
  15 min après un trade perdant du même compte, `BehaviorSignalsService`, depuis `TradesService.create`). Jamais émis ; exclus
  de l'historique et de l'autopsie (#669) ; sans poids dans les seuils tant que le rapport silencieux n'est pas validé.
- **App** : `BehaviorAlertsStore` (alertes de la séance en mémoire, `behaviorTone` : rouge si gravité haute ou autre détecteur
  du même compte en 30 min) ; bandeau `mtc-live-behavior-alert` dans le bloc collant de la Session live (deux zones
  `aria-live` persistantes, polie et assertive) ; `mtc-debrief-behavior-alerts` ; `mtc-behavior-mutes` au Profil. Trade
  rapide : plus d'émotion présélectionnée.
- **Messages des détecteurs** : espace insécable avant « : » et « % », « 11ᵉ », apostrophe ’ (affichés tels quels).
- **Démo** : alertes ambre et rouge et un détecteur coupé (`demo-data/behavior-alerts-example.ts`) ; pas de bandeau (pas de
  séance live en démo).
- **Hors périmètre** : seuils (après validation du rapport silencieux par Greg), activation du flag (dev puis prod, par Greg),
  conservation de `BehaviorAlert` (#1338).

## Contrat de session (#667, 2026-11-28)

- Primitives écrites une fois dans `@mtc/shared` (`session-rules.ts`) : `trailingLosses` (C1), `overMax` (C2),
  `nearHighImpactNews` (stat #670 du débrief, règle des annonces du contrat) ; `assetCurrencies` et `assetRoot`
  déplacés dans `asset-currencies.ts` (réexporté par `eco-calendar.briefing.ts`). Spec d'équivalence C1 / C2 ↔ contrat
  (`behavior-contract-equivalence.spec.ts`).
- Séance avec contrat et `SESSION_CONTRACT_ENABLED` allumé : `BehaviorAlertsService.check` prend la règle en vigueur
  à l'entrée (`ruleAt`) comme seuil de C2 (`maxTrades`, sinon `tradesPerDayMax`), de D1 (`newsMinutes`, sinon le
  bouclier) et de C1 (`contractLossStreak`) ; C1 avec contrat sonne aussi en apprentissage. Sans contrat : inchangé.
- Évaluation (`evaluateContract`, `@mtc/shared`) : infraction au trade qui franchit la règle (trades max : le N+1ᵉ ;
  pertes d'affilée : l'entrée après N pertes ; perte max : P&L net réalisé sous −X ; actifs : racine hors liste ;
  annonces : `tradedAt` dans [T−X, T+X] d'une annonce forte de ses devises, sans objet sans annonce du jour). Règle en
  vigueur reconstituée depuis `edits` : desserrer après l'infraction ne l'efface pas. « Ensuite » = trades clôturés
  suivants, net, devise du compte. Calculée à la lecture (`GET /session/today`, `GET /session/history/:id`).
- Interface (pré-session, live, débrief) : ticket de suite ; l'alerte du contrat (ambre) y remplacera le bandeau
  #671 de C1 et C2 pour ces règles.

