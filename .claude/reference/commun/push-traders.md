# Notifications push des traders (#666)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Notifications push des traders (#666, phase 1 API, 2026-10-23) · 2026-10-23 -->
> **Origine** : `nestjs.md` · « Notifications push des traders (#666, phase 1 API, 2026-10-23) » · 2026-10-23

## Notifications push des traders (#666, phase 1 API, 2026-10-23)

Module `modules/push/` (`TraderPushModule`). Plan et décisions : `docs/audit-push-traders.md`.
- Services métier → **`TraderNotifier.notify(userId, type, message, { accountId?, dedupKey, force? })`**
  uniquement, injecté en `@Optional()` en dernier paramètre. Ne lève jamais, n'attend pas l'envoi.
- **Filtres côté API, dans l'ordre** (`TraderNotifier.send`, renvoie la raison) : push actif, compte
  démo, au moins un appareil, plan (`PUSH_PREMIUM_TYPES` : `isPremiumAccess`), type coupé
  (`TraderPushPreference.mutedTypes`, défaut `[RECAP]`), heures silencieuses (`quiet-hours.ts`, heure de
  Paris, plage à cheval sur minuit possible ; aucun fuseau par utilisateur en base), anti-spam Redis
  `push:spam:<user>:<compte>:<dedupKey>` (`SET NX PX 15 min`, Redis indisponible = on envoie).
  `force: true` (limite prop firm franchie) passe l'anti-spam mais **ni** les types coupés **ni** les
  heures silencieuses ; la clé est posée quand même.
- **Branchements** : `PropAlertsService` (`PROP_RULES` : 10 %, franchi, objectif, payout ; le 25 % et
  l'approche de la consistency restent dans l'app ; `force` sur `breached`), `TiltAlertsService` et
  `BehaviorAlertsService` (`BEHAVIOR` ; comportement seulement si `BEHAVIOR_ALERTS_UI=true`),
  `DailyRecapProcessor` (`RECAP`, après l'e-mail), `TradovateConnectionService.markNeedsReconnect`
  (`CONNECTION`, gratuit, au passage seulement, jamais démo). ⚠️ Les alertes en direct ne naissent que
  si un WebSocket Tradovate est ouvert : app ouverte, ou veille serveur pendant la séance (#770, voir
  « Temps réel »).
- **App fermée : relevé par la synchro de fond** (`TradovateBackgroundRefreshCron`, 15 min, 0 appel
  Tradovate en plus) : après chaque synchro de fond réussie, `PropAlertsService.checkFromBackground`.
  Seulement `BACKGROUND_ALERT_KINDS` (drawdown, perte du jour, objectif, payout ; pas la consistency),
  comptes ACTIVE seulement (échoués et archivés exclus), PUSH SEULEMENT : ni événement d'app, ni journal
  de séance (#373), ni incident `live` (#669).
- **Deux marqueurs Redis par alerte** (revue #717, I3) : `prop-alert:<compte>:<type>:<période>` =
  « affichée dans l'app » (direct seulement) et `prop-alert-push:…` = « push envoyé » (direct et fond,
  `prop-alert-push.ts`). Le fond ne touche JAMAIS le premier : une alerte relevée app fermée s'affiche
  à l'ouverture, sans second push si le push est parti. Le marqueur push est réservé ATOMIQUEMENT
  (Lua, rang du niveau) avant `TraderNotifier.send`, et rendu si l'envoi n'a pas eu lieu (aucun
  appareil, type coupé, heures silencieuses) : direct et fond simultanés ne poussent qu'une fois, même
  une limite franchie. En direct, le push n'est tenté qu'au moment où l'alerte s'affiche.
  `TraderNotifier.send` ne rend `sent` que si **au moins un appareil a reçu** le push ; sinon
  `undelivered` (5xx, délai dépassé, 404/410, adresse hors liste blanche) : réservation rendue, retenté
  au relevé suivant, la clé anti-spam reste posée (15 min pour une alerte non forcée). Au plus
  `MAX_UNDELIVERED_PUSH` (3) envois sans livraison par niveau et par période : ensuite le marqueur est
  gardé (abandon journalisé), une limite franchie forcée ne repart pas toutes les 15 min toute la journée.
  Seul `undelivered` consomme un essai, jamais aucun appareil, type coupé ou heures silencieuses
  (testé). Compteur `…:undelivered:<niveau>` : `INCR` et `EXPIRE` dans UN script Lua, la clé
  n'existe jamais sans TTL (`prop-alert-push.int-spec.ts`, vrai Redis). Redis indisponible après
  l'envoi : journal « envoyé sans livraison, suivi Redis impossible », la réservation reste posée
  jusqu'à son expiration (pas de spam) ; « non envoyé » seulement si la réservation a échoué avant.
  Le réarmement en fond n'efface que `prop-alert-push:…`, le direct efface les deux.
- **Fond** : texte suivi de `BACKGROUND_NOTE` (« Relevé automatique, jusqu'à 15 min de décalage. »),
  seul cas à deux phrases. Anti-tilt et comportement : jamais depuis le fond.
- **Textes** (`trader-push-messages.ts`) : une phrase factuelle, **aucun montant**, **jamais le
  libellé saisi par le trader** (écran verrouillé) : repère `{compte}` remplacé dans
  `TraderNotifier` par le nom de catalogue (`push-account-name.ts` : « Apex 50K », « Apex 50K compte 2 »
  pour le suivant de même firme et taille, « ton compte » sans plan relié). « (estimation
  MyTradingCoach) » sur toute règle de firm (détecteurs A compris), aucun conseil. Vocabulaire du
  drawdown (#938) : « marge avant le plancher » (critique), « Plancher de drawdown franchi »
  (dépassé), jamais « drawdown max » pour la règle. Même vocabulaire dans le prompt du débrief
  (« règle de drawdown », « MARGE estimée avant le plancher », #936) et les erreurs des DTO de
  compte (« La règle de drawdown… »). Clic →
  `/session` (récap → `/dashboard`, connexion → `/accounts`). TTL : 1 h pour une alerte de séance.
  Payload `TraderPushPayload` (`@mtc/shared`), lu par le service worker maison de l'app (phase 2).
- **Routes `/push/*`** (`JwtAuthGuard`, mutations bloquées en démo par `DemoReadOnlyGuard`) :
  `GET settings`, `POST device` / `subscribe` / `unsubscribe` (endpoint dans le corps), `DELETE
  devices/:id`, `PATCH preferences` (`quietHours: null` = désactivées), `POST test` (sans filtre, 3/min).
  `POST device` (lecture) est `@DemoAllowed`. Adresse d'abonnement : liste blanche des services push
  (`push-endpoint.ts`, DTO et avant chaque envoi) ; envoi borné (`push-http.ts` : 10 s au total, 16 Ko
  de réponse au plus, aucune redirection).
  Au plus `MAX_PUSH_DEVICES` = 10 appareils par trader (le plus ancien part). L'endpoint n'est jamais
  renvoyé ; libellé d'appareil déduit du User-Agent (`device-label.ts`).

<!-- Origine : angular.md · Notifications push des traders (#666 phase 2, 2026-10-24) · 2026-10-24 -->
> **Origine** : `angular.md` · « Notifications push des traders (#666 phase 2, 2026-10-24) » · 2026-10-24

## Notifications push des traders (#666 phase 2, 2026-10-24)

Maquette qui fait foi : `maquettes/mockup-push.html` (6 états + bureau). API : `nestjs.md`.
- **Service worker maison** `public/push-sw.js` : push SEULEMENT, aucun `fetch`, aucun cache (l'app
  n'est jamais servie par lui). Au clic : ouvre ou met au premier plan `data.url`, revérifié comme
  chemin interne (`safePath` : `/…` seulement, ni `//`, ni `\`, ni autre origine, ni chemin qui
  devient `//hôte` une fois normalisé comme `/..//evil.com` ; sinon `/`). Charge utile `null` ou
  non-objet : notification neutre. Action
  « Réglages » → `settingsUrl` (`/profil#notifications`). Testé dans un bac à sable `node:vm`
  (`core/push/push-sw.spec.ts`). Enregistré avec `updateViaCache: 'none'`, seulement au clic sur
  « Activer » (jamais au chargement).
- **`core/push/push-browser.ts`** : `PUSH_BROWSER` (environnement, abonnement courant, `subscribe`),
  remplaçable dans les tests. **`core/push/push.service.ts`** : états `server-disabled`,
  `in-app-browser`, `ios-not-installed`, `unsupported`, `denied`, `supported`, `subscribed` ;
  permission demandée par `enable()` seulement (demande fermée sans réponse : message neutre, pas
  d'échec) ; abonnement inconnu du serveur resynchronisé ; limite `PUSH_MAX_DEVICES` (`@mtc/shared`).
  **Propre à un compte** (revue phase 2 I2) : inscrit à `UserScopedReset` et remis à zéro à tout
  changement d'utilisateur (effet sur `currentUser`), requêtes en cours annulées (`AbortSignal`
  passé à `PushApi`), réponse du compte précédent ignorée (génération), aucune commande tant que
  `state` vaut `null`. **Écritures en file** (I1) : une à la fois, chacune calculée sur ce que le
  serveur a enregistré ; après un échec, changements en attente abandonnés (`skipped`), réglages
  relus et réaffichés, un seul `failed` donc un seul toast. `PushApi` entièrement en
  `SILENT_ERRORS` : la section a ses propres messages.
- **Déconnexion** (`core/push/push-logout.ts`, appelé par `AuthService.logout` sans l'attendre) :
  abonnement de CET appareil retiré côté navigateur D'ABORD (`unsubscribe()`, local, sans réseau :
  l'adresse meurt chez le service push même si l'onglet se ferme), puis côté API avec le jeton
  d'AVANT la déconnexion (`HttpBackend`, sans intercepteur), 5 s au plus, en `keepalive` (revue
  phase 2 I6). Un échec ne bloque rien : la ligne serveur part au premier 404 ou 410. Sans ça, sur
  un appareil partagé, les alertes du compte arrivaient chez la personne suivante.
  Poids (revue phase 2 m7, mesuré le 25/10/2026 au build de production) : bundle initial 492,76 ko
  contre 489,25 ko sur `dev` (`69bffaf2`), soit +3,51 ko bruts (+1,11 ko transférés) pour toute la
  phase 2 ; reste 7,24 ko sous le plafond bloquant de 500 ko. La section est un chunk paresseux
  (`push-settings-component`, 28,81 ko).
- **Section du profil** `features/profile/notifications/push-settings.component` : onglet
  Paramètres, chargée par `@defer (on viewport; when openNotifications)` ; `/profil#notifications`
  ouvre l'onglet et charge tout de suite. La modale « Modifier ma stratégie » ne s'ouvre seule
  (premier passage, aucune stratégie) que sur `/profil` sans `#notifications` ni `?tab=` : le
  bandeau « Compléter » du tableau de bord compte dessus, les liens profonds (push, « Gérer mes
  e-mails ») non ; `profile-strategy-modal-auto.spec.ts`. Masquée sans erreur si le push est coupé côté serveur ;
  démo en lecture seule (aucun appel `device`, aucun bouton d'action). Gratuit : lignes Premium
  verrouillées + modale des offres, seule `CONNECTION` active. Interrupteurs `role="switch"`
  étiquetés (`aria-labelledby`), cibles de 44 px, `scroll-margin-top` sous la barre fixe.
  Couleurs : variables de `theme.css`, sauf le texte blanc du bouton principal (`--primary`) ;
  badges Premium violets (`--purple-bright` sur `--purple-dim`, comme `premium-lock`).
  **Mise en page** (revue I3, m1) : toute la largeur, aucun `max-width` ; cartes dans l'ordre du DOM
  (= ordre mobile = ordre du clavier : cet appareil, types avec l'invitation Premium sous leur titre,
  heures silencieuses, appareils), chaque bloc ouvert par un petit titre pour aligner le haut des
  colonnes au bureau (« Cet appareil » au-dessus de la carte d'état), en
  grille `repeat(auto-fit, minmax(min(100%, 420px), 1fr))`, types sur deux rangées dès deux
  colonnes (`@container`), mention SOUS la grille (une carte `1 / -1` garderait des colonnes vides à
  2560 px). Aucun `order` ni `display: contents` (`push-settings.styles.spec.ts`). Heures
  silencieuses : début égal à la fin refusé (« Choisis deux heures différentes », 400 côté API),
  champ vidé ou refusé remis à la valeur enregistrée. Seed démo : 2 appareils, 22:00 à 07:00.
- **iPhone ou iPad sans `<link rel="manifest">`** (lien lu dans le document, pas un drapeau ;
  `BrowserEnv.hasManifest`) : état `ios-unavailable`, seulement « Les alertes sur iPhone ne sont
  pas encore disponibles. », ni étapes, ni types, ni activation, même ouverte en mode app (iOS 26
  l'ouvre ainsi sans manifest). L'activation revient seule quand #715 ajoute le lien (revue F4).
- iPhone sans installation (manifest présent) : aide FIXE « Pour recevoir des alertes sur iPhone, ajoute MyTradingCoach
  à l'écran d'accueil, puis ouvre-la depuis son icône » et « Partager, puis Sur l'écran d'accueil,
  puis Ajouter », sans bouton, sans durée ni promesse (revue phase 2 I4), en attendant le parcours
  d'installation (#715). Sans manifest (#715), l'app ajoutée à l'écran d'accueil d'un iPhone avant
  iOS 26 ne s'ouvre pas en mode app, donc pas de push iOS avant #715 : `TRADER_PUSH_ENABLED` reste
  coupé en production jusque-là (`deploy.md`) ; coupé, la section est absente de l'app.
- Délai affiché par type (`rowDelay`) : `delay` (« si MTC est ouvert ») ou, si
  `settings.liveWhileClosed` (veille serveur #770 allumée côté API), `delayWhileClosed` (« En direct
  pendant ta séance, même MTC fermé »). Jamais le second sans le drapeau : dit honnêtement.

<!-- Origine : prisma.md · Notifications push des traders (#666, 2026-10-23) · 2026-10-23 -->
> **Origine** : `prisma.md` · « Notifications push des traders (#666, 2026-10-23) » · 2026-10-23

## Notifications push des traders (#666, 2026-10-23)

`UserPushDevice` : un appareil (navigateur / PWA) d'un trader, même forme que
`AdminPushSubscription` sans préférence par appareil ; `endpoint` unique (un endpoint déjà connu est
rattaché au trader qui s'abonne), supprimé sur 404/410. `TraderPushPreference` (clé = `userId`) :
réglages valables pour tous les appareils, `mutedTypes PushAlertType[]` (défaut `[RECAP]`),
`quietStart` / `quietEnd` en minutes depuis minuit, heure de Paris (null = aucune). Pas de ligne =
défauts. Table dédiée plutôt que des colonnes sur `User` (lu à chaque requête). Cascade à la
suppression du User. Enum `PushAlertType` copié dans le contrat (`contracts-sync.spec.ts`).
Migration `20261023180000_trader_push` (ajouts seuls, compatible N-1).

## Bouclier annonces (#670, 2026-11-23)

Push `TRADER_PUSH_MESSAGES.news` (catégorie `BEHAVIOR`, titre « Annonce à venir », urgence haute, tag
`news-<compte>-<créneau>`) envoyé par `NewsShieldService` même si `BEHAVIOR_ALERTS_UI` est éteint : seule
exception à « push jamais en phase silencieuse » (décision de Greg du 2026-11-23). Coupé avec
`NEWS_SHIELD_ENABLED`. Voir `detecteurs-comportement.md`.
