# Notifications push de l'admin

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/deploy.md`, `.claude/agents/nestjs.md`, `.claude/agents/prisma.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Notifications push de l'admin (2026-10-15) · 2026-10-15 -->
> **Origine** : `nestjs.md` · « Notifications push de l'admin (2026-10-15) » · 2026-10-15

## Notifications push de l'admin (2026-10-15)

Module `modules/admin-push/` : Web Push (PWA) vers les appareils **ADMIN** pour les événements
business. Pas une supervision de pannes (UptimeRobot + `watch-containers`).
- Services métier → **`AdminNotifier.notify(event, message)`** uniquement (jamais `AdminPushService`).
  Ne lève jamais, n'attend pas l'envoi (tâche de fond, erreurs en `warn`). Injecté en
  `@Optional()` en dernier paramètre : les specs historiques construisent le service sans lui.
- Messages : catalogue `ADMIN_PUSH_MESSAGES` (`push-messages.ts`). **Aucune donnée sensible** (pas
  d'e-mail, de montant, de token) : titre neutre + `url` de l'admin ouverte au clic.
- Livraison (`AdminPushService.deliver`) : appareils dont l'utilisateur est `role = ADMIN` **au
  moment de l'envoi**, filtrés par `mutedEvents` (préférences par appareil) ; 2xx → `lastSuccessAt`,
  404/410 → abonnement supprimé ; journaux = hôte du service push seulement (l'endpoint contient un jeton).
- Journal d'envoi (`push-delivery.ts`, admin et traders) : UNE ligne par tentative et par appareil
  (info si livré ou 404/410 abonnement supprimé ; warn pour 5xx, autres 4xx, délai, erreur réseau),
  `Envoi push <admin|trader> <TYPE> : livré|échec (<2xx|404|410|4xx|5xx|délai dépassé|erreur réseau>, <hôte>)`.
  Jamais l'endpoint, ses clés, l'id d'appareil ni le message d'une exception (il peut citer l'adresse) ;
  délai = `PushDeadlineError` (`push-http.ts`). Contrat verrouillé par `push-delivery.spec.ts`.
- Journaux des notifieurs (`TraderNotifier`, `AdminNotifier`), tous niveaux debug compris : type,
  « forcé », résultat et compteurs seulement ; jamais la clé anti-doublon (`dedupKey`, texte libre de
  l'appelant), ni userId / accountId / clé Redis ; une exception = son nom de classe (`errorKind`,
  `push-delivery.ts`), jamais son message. Verrouillé par `trader-notifier.logs.spec.ts`.
- Même règle pour `PropAlertsService` (alertes prop firm, Tradovate) : type et niveau d'alerte +
  `errorKind`, jamais l'id de compte, l'id utilisateur ni la clé Redis. `prop-alerts.logs.spec.ts`.
- Branchements : Stripe (`checkout.session.completed`, `invoice.payment_succeeded` en
  `subscription_cycle` > 0 €, `invoice.payment_failed`, `customer.subscription.deleted`) **en fin de
  handler**, donc après l'idempotence `StripeEvent` ; candidature ambassadeur (`referral` + `public`) ;
  inscription (`AuthService.register`, jamais ADMIN) ; Tradovate `markNeedsReconnect` **au passage**
  vers NEEDS_RECONNECT, jamais pour la démo (seul chemin d'écriture de ce statut).
- Config : `PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`config/push-config.ts`). Absentes/invalides → push désactivé, l'API démarre (log au boot).
  Traders (#666) : en plus `TRADER_PUSH_ENABLED=true` (`resolveTraderPushFlag`, jeton
  `TRADER_PUSH_FLAG` de `PushCoreModule`, éteint si absent) ; `TraderPushService.enabled` exige
  les deux, l'admin ne lit que `PUSH_ENABLED`. Éteint : `enabled: false` et `publicKey: null` sur
  `GET /push/settings`, 503 sur `subscribe` et `test`, notifieur `disabled` ; `DELETE
  /push/devices/:id` et `POST /push/unsubscribe` restent ouverts (`push-switches.spec.ts`).
  Clés : `node tools/scripts/vapid-generate.mjs`. Changer de paire invalide les abonnements.
- Routes `/admin/push/*` (garde de classe) : `public-key`, `subscribe`, `unsubscribe`, `device`,
  `preferences` (PATCH), `test`. L'appareil est identifié par son endpoint, dans le corps.
- **Nouvel événement** = valeur de l'enum `AdminPushEvent` (migration) + copie dans
  `libs/shared/src/contracts/enums.ts` + libellé `ADMIN_PUSH_EVENT_LABELS` + message + branchement + test.
- Socle commun avec les traders (#666) : config VAPID et émetteur dans `modules/push/push-core.module.ts`
  (`PUSH_CONFIG`, `PUSH_SENDER`), boucle d'envoi `deliverPush` (`push-delivery.ts`), DTO d'abonnement
  `push/dto/push-subscription.dto.ts`. Une seule paire VAPID pour l'admin et l'app.

<!-- Origine : angular.md · Admin : PWA et notifications push (2026-10-15) · 2026-10-15 -->
> **Origine** : `angular.md` · « Admin : PWA et notifications push (2026-10-15) » · 2026-10-15

## Admin : PWA et notifications push (2026-10-15)

- `@angular/service-worker` (épinglé à la version de `@angular/core`) : `provideServiceWorker`
  **désactivé en dev** (`isDevMode()`), `ngsw-config.json` déclaré dans `project.json`
  (`serviceWorker`). Manifest « MTC Admin » + icônes dans `public/icons/` ; les PNG se régénèrent
  depuis `icon.svg` : `node tools/scripts/generate-admin-icons.mjs`. Balises iOS dans `index.html`.
- `core/push/push.service.ts` (repris de xmr-trader) : `browserSupport()` → `ios-not-installed`
  (iPhone hors écran d'accueil), `unsupported`, `denied`, `server-disabled`, `supported` ;
  `BROWSER_ENV` remplaçable dans les tests. Page `/notifications` : interrupteur de l'appareil,
  événements (`ADMIN_PUSH_EVENT_LABELS` de `@mtc/shared`), « Tester la notification ».
- ⚠️ **Cache** : `ngsw-worker.js`, `safety-worker.js`, `worker-basic.min.js` doivent être servis
  **sans cache** (sinon le SW ne se met plus jamais à jour). Nginx : `location =` dédiées dans
  `spa-releases.conf` (admin servi par l'ancien VPS, pas de Vercel ; voir `deploy.md`).
- **Installée sur l'écran d'accueil (iOS)** : `viewport-fit=cover` + status bar `black-translucent`
  + `theme-color` = `--bg` (#070809) → la page passe **sous** la barre d'état. Marges de sécurité :
  variables `--safe-top/right/bottom/left` (`:root` de `styles.css`, `env(safe-area-inset-*)`), lues
  par `.topbar`, `.sidebar`, `.content`, `.log-terminal`, toasts, `.modal-overlay`, tiroir de la
  surveillance. Nouvel élément fixe ou collé à un bord → ces variables, jamais `env()` en dur.
  Contrôle Playwright : surcharger les variables (`:root{--safe-top:47px;--safe-bottom:34px}`),
  Chromium ne simule pas les safe-area. En-tête < 480 px : `.tb-meta` masqué, statut réduit au point.

<!-- Origine : deploy.md · Notifications push de l'admin (2026-10-15) · 2026-10-15 -->
> **Origine** : `deploy.md` · « Notifications push de l'admin (2026-10-15) » · 2026-10-15

## Notifications push de l'admin (2026-10-15)

- Variables de l'API (prod : `.env.production` du VPS prod) : `PUSH_ENABLED=true`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:hello@mytradingcoach.app`
  (`node tools/scripts/vapid-generate.mjs`, clé privée jamais commitée). Recréer l'API ensuite.
- Service worker de l'admin : jamais en cache. `infra/static/nginx/spa-releases.conf` a des
  `location =` en `no-cache` pour `ngsw-worker.js` / `safety-worker.js` / `worker-basic.min.js`
  (sinon la règle des `.js` les fige 1 an). L'admin est servi par l'**ancien VPS** : sur ce VPS,
  `spa-releases.conf` est un fichier **partagé** par `mtc_admin`, `mtc_app_dev_static` et
  `mtc_app_beta_static` (bind-mount d'un fichier unique) ; le modifier change aussi dev et beta.
- **Push des traders (#666) : interrupteur séparé `TRADER_PUSH_ENABLED`**, éteint si absent (seule
  la valeur `true` l'allume). Le push des traders exige `PUSH_ENABLED=true` (clés VAPID valides) ET
  `TRADER_PUSH_ENABLED=true` ; l'admin reste piloté par `PUSH_ENABLED` seul (déjà à `true` en prod).
  Éteint : section Notifications absente de l'app (`GET /push/settings` → `enabled: false`),
  `POST /push/subscribe` et `/push/test` en 503, aucun envoi ; retrait d'un appareil et
  désabonnement à la déconnexion marchent toujours.
- **`TRADER_PUSH_ENABLED` ne s'allume pas en production avant le manifest de #715 (étape 1) ET les
  essais de Greg sur un vrai iPhone installé, un vrai Android et un PC.** Sans manifest, l'app
  ajoutée à l'écran d'accueil d'un iPhone avant iOS 26 s'ouvre dans Safari (pas en mode app, donc
  pas de push). Depuis iOS 26, tout site ajouté s'ouvre en mode app par défaut, mais le push sans
  manifest n'a pas été vérifié sur un vrai iPhone.
  **Règle aussi imposée dans le code** : sur iPhone et iPad, tant que la page n'a pas de
  `<link rel="manifest">`, la section affiche seulement « Les alertes sur iPhone ne sont pas encore
  disponibles. » (état `ios-unavailable`, ni étapes ni activation). Le manifest de #715 en ligne,
  l'activation revient seule.
- **Push des traders sur beta, pour les essais** (ancien VPS, `/opt/apps/mytradingcoach/beta`).
  Clés VAPID PROPRES à beta : jamais celles de la prod (une paire partagée laisserait beta signer
  des push reçus comme ceux de la prod), jamais commitées, jamais affichées. Commandes à taper par
  Greg (fichier `.env.beta` à lui, droits root) :
  ```bash
  cd /opt/apps/mytradingcoach/beta
  grep -cE '^(PUSH_ENABLED|TRADER_PUSH_ENABLED|VAPID_[A-Z]+)=' .env.beta   # attendu : 0 (sinon éditer, pas d'ajout en double)
  # Paire générée dans le conteneur API beta (web-push y est installé), écrite sans affichage :
  docker exec mtc_api_beta node -e "const k=require('web-push').generateVAPIDKeys();process.stdout.write('PUSH_ENABLED=true\nTRADER_PUSH_ENABLED=true\nVAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=mailto:hello@mytradingcoach.app\n')" >> .env.beta
  grep -E '^(PUSH_ENABLED|TRADER_PUSH_ENABLED|VAPID_[A-Z]+)=' .env.beta | cut -d= -f1 | sort | uniq -c   # 1 de chaque
  docker inspect mtc_api_beta --format '{{index .Config.Labels "com.docker.compose.project"}}'   # projet compose
  docker compose -p <projet> -f docker-compose.beta.yml up -d --force-recreate api   # relit .env.beta (pas docker restart)
  docker logs mtc_api_beta 2>&1 | grep 'Notifications push des traders'   # attendu : « activées »
  ```
  Couper : `TRADER_PUSH_ENABLED=false` (l'admin de beta, s'il en a, garde son push), puis recréer
  l'API. Changer la paire invalide les abonnements beta (réabonner depuis le profil).
- **Veille serveur (#770) : `TRADOVATE_WATCH_MAX`**, plafond de WebSockets Tradovate gardés app
  fermée. Absente ou `0` = **éteinte** (défaut partout), conseillé `500`. Exige aussi le push des
  traders. Beta : `TRADOVATE_WATCH_MAX=500` dans `.env.beta` puis recréer l'API (même procédure
  que ci-dessus). Dev : posée le 2026-10-26. **Prod** : coût mesuré (`docs/ops/test-charge-vps-prod.md`
  section 6 : ≈ 3 % d'un cœur pour 1 000 veilles) ; poser `TRADOVATE_WATCH_MAX=500` dans le `.env` de
  l'API prod (blue, green, worker) AVANT la promotion qui apporte le texte « en notification » de la
  landing et de `PLAN_BENEFITS` (`plans.md`, veille serveur) : inerte sur l'ancien code. Couper : retirer la variable ou `0`, recréer l'API (les WS en veille
  se ferment à l'arrêt ; le registre Redis `tradovate:watch` expire seul en ≤ 10 h, inerte éteint).
  Journal : `Veille Tradovate : N reprise(s)` (après un déploiement), `plafond … atteint` en warn.
- **`TRADOVATE_LINK_DIAGNOSTIC` : retirée du code** (#955, liaison par stratégie d'ordres). Posée en prod
  le 2026-11-12 (`.env.production`), elle est inerte depuis : la retirer du `.env` à l'occasion, sans urgence.
- Service worker de l'**app** (`push-sw.js`, #666) : fichier fixe à la racine, push seulement. Il est
  enregistré avec `updateViaCache: 'none'` : le navigateur le revérifie sur le réseau même si la
  règle des `.js` le met en cache un an. Une `location = /push-sw.js` en `no-cache` reste possible
  (même fichier partagé `spa-releases.conf` sur l'ancien VPS ; config de l'app prod sur le VPS prod),
  pas indispensable.

<!-- Origine : prisma.md · Notifications push de l'admin (2026-10-15) · 2026-10-15 -->
> **Origine** : `prisma.md` · « Notifications push de l'admin (2026-10-15) » · 2026-10-15

## Notifications push de l'admin (2026-10-15)

`AdminPushSubscription` : un appareil (navigateur / PWA) d'un ADMIN. `endpoint` unique, clés
`p256dh` / `auth`, `mutedEvents AdminPushEvent[]` (événements coupés sur cet appareil, vide = tout),
`lastSuccessAt`. Cascade à la suppression du User. Supprimé par l'API sur réponse 404/410 du service
push. Enum `AdminPushEvent` copié dans le contrat (`contracts-sync.spec.ts`). Migration
`20261015220000_admin_push_subscription` (ajouts seuls, compatible N-1).
