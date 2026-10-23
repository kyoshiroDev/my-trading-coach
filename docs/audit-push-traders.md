# #666 · Notifications push pour les traders · plan

> Plan court avant code (consigne du ticket), validé par Greg le 2026-10-23 avec les décisions de
> la section 6. Branche `feat/666-push-traders`, partie de `origin/dev`. Phase 1 (API) codée.

## 1. Ce qui existe

| Brique | Où | Réutilisable ? |
|---|---|---|
| Envoi Web Push (VAPID, aes128gcm, 404/410 → abonnement supprimé) | `modules/admin-push/push-sender.ts`, `admin-push.service.ts` (`deliver`) | Oui : extraire la livraison dans un service commun |
| Config `PUSH_ENABLED` + `VAPID_*` | `config/push-config.ts` | Oui : mêmes clés pour l'app (une paire VAPID sert plusieurs origines) |
| Payload `@angular/service-worker` | `admin-push/push-messages.ts` (`angularPushPayload`) | À adapter si l'app n'utilise pas ngsw (voir 3.6) |
| Alertes prop firm (#370) : drawdown, perte du jour, consistency, objectif, payout | `integrations/tradovate/prop-alerts.service.ts` | Point d'accroche : là où part `prop:alert` |
| Anti-tilt (#371) | `integrations/tradovate/tilt-alerts.service.ts` | Point d'accroche : `tilt:alert` |
| Comportement (#602, phase silencieuse) | `behavior/behavior-alerts.service.ts`, flag `BEHAVIOR_ALERTS_UI` | Point d'accroche, seulement si le flag est vrai |
| Récap du jour 17h30 (e-mail) | `daily-recap/daily-recap.processor.ts` | Point d'accroche : « ton récap est prêt » |
| PWA | admin seulement (`ngsw-config.json`, `manifest.webmanifest`, `core/push/push.service.ts`) | Modèle pour l'app, qui n'a ni service worker ni manifest |

## 2. Constat qui change le périmètre

**Aujourd'hui, aucune alerte ne naît quand l'app est fermée.** Les trois détecteurs en direct
(prop firm, anti-tilt, comportement) tournent sur le WebSocket Tradovate, ouvert seulement tant
qu'un onglet est connecté à `/tradovate-live` (`TradovateLiveService.attach/detach` : « dernier
onglet fermé → WebSockets fermés, plus rien ne tourne pour ce user »). Le cron de fond (15 min)
ne fait que synchroniser les trades, sans évaluer d'alerte.

Conséquences :
- **PC, onglet ouvert derrière Tradovate ou TradingView** : le push fonctionne tel quel. C'est le
  cas décrit dans le « Pourquoi » du ticket.
- **Onglet fermé, ou PWA mobile en arrière-plan** (iOS coupe la connexion en quelques secondes) :
  le service worker recevrait bien un push, mais rien ne l'envoie. Le critère « fonctionne onglet
  fermé » n'est tenu que si l'API garde le suivi Tradovate sans client connecté. Voir 3.1.

## 3. Choix ouverts et proposition

**3.1 Suivi sans app ouverte.**
- (A) Push seulement tant qu'une session de l'app est ouverte, même en arrière-plan. Aucune charge
  Tradovate en plus. Le mobile est presque inutile.
- (B) **Veille serveur** : pour un trader Premium avec au moins un appareil abonné ET une séance
  ouverte dans la Session live, le WebSocket Tradovate reste ouvert après la fermeture du dernier
  onglet, jusqu'à la clôture de la séance, au plus 10 h. Même bail Redis, même code de synchro,
  aucun appel IA. Coût : un WebSocket par trader en veille, à mesurer contre le plafond actuel
  (~2 500 simultanés, `docs/ops/test-charge-vps-prod.md`).
- **Proposition** : A en phase 1-2 (livrable vite, utile sur PC), B en phase 4 séparée, avec test
  de charge. Le texte de l'app dit honnêtement « pendant ta séance, app ouverte » jusqu'à B.

**3.2 Gating.** Le ticket propose les alertes prop firm en Free, mais elles sont **Premium**
aujourd'hui (#370, `plans.md` l. 246) : `metrics.dailyLoss` n'est même pas calculé en Free.
- **Proposition** : ne pas changer les plans. Le push relaie seulement les alertes que le plan
  donne déjà. Toutes les alertes en direct sont Premium, donc le push l'est en pratique. Un Free
  voit la section Notifications avec le teaser Premium habituel. Si Greg veut du Free, un type
  « plancher franchi » (sans perte du jour) serait le seul candidat : à décider à part, avec les
  4 points de `plans.md`.

**3.3 Types d'alerte (réglage par type, côté API).**

| Type | Source | Défaut | Proposition |
|---|---|---|---|
| Règles prop firm | `prop:alert` : critical, breached, objectif, payout | activé | `warning` (25 %) reste dans l'app seulement, pour ne pas sonner trop tôt |
| Comportement | `tilt:alert` + `behavior:alert` (si `BEHAVIOR_ALERTS_UI=true`) | activé | un seul interrupteur pour les deux |
| Récap | récap du jour prêt (17h30) | coupé | lien vers le tableau de bord, pas la Session live |
| Annonces | aucune source aujourd'hui | absent | **hors V1** : pas de push marketing sans consentement distinct ni outil d'envoi admin |

**3.4 Heures silencieuses.** Réglage par utilisateur, heure de Paris (pas de fuseau en base,
comme le reste de l'app), désactivé par défaut, 22:00-07:00 proposé à l'activation. Appliqué côté
API avant l'envoi. **Proposition** : aucune exception, même pour « limite franchie » : le trader
qui trade la nuit coupe ses heures silencieuses.

**3.5 Anti-spam.** Clé Redis `push:spam:<accountId>:<type>:<kind>` en `SET NX PX 15 min` : la même
alerte au plus une fois toutes les 15 min par compte, en plus des règles existantes (un niveau par
jour pour le prop firm, 15 min pour le comportement).

**3.6 Service worker de l'app.** L'admin utilise `ngsw`, qui met l'app en cache.
- **Proposition** : pour l'app, un **service worker minimal écrit à la main** (`push-sw.js` :
  `push` + `notificationclick`, aucun gestionnaire `fetch`, aucun cache). Zéro risque d'app
  périmée après un déploiement. Installation en PWA : manifest + icônes 192/512 + `apple-touch-icon`,
  `display: standalone`. Nginx sert `push-sw.js` en `Cache-Control: no-cache`.

**3.7 Préférences : par utilisateur, pas par appareil** (l'admin fait par appareil). Plus simple
à expliquer, et le ticket parle de réglages par type, pas par appareil. La liste des appareils
sert seulement à les supprimer.

**3.8 Texte des notifications.** Une phrase factuelle, libellé du compte et pourcentage, **sans
montant** (écran verrouillé visible par d'autres). Exemples :
- « Apex 50K · marge drawdown sous 10 % (estimation MyTradingCoach) »
- « Apex 50K · limite de perte du jour atteinte, d'après tes trades synchronisés »
- « Apex 50K · objectif atteint (estimation MyTradingCoach) »
- « Reprise rapide après une perte sur Apex 50K »

Clic : ouvre `/session`. Action « Réglages » (Chrome, Android ; pas iOS) qui ouvre
`/profil#notifications`, où la désinscription se fait en un clic.

**3.9 Maquette.** La section « Notifications » du profil (activation sur cet appareil, aide iOS
« ajouter à l'écran d'accueil », liste des appareils, types, heures silencieuses, teaser Free)
mérite une maquette `maquettes/mockup-push.html` (390 puis 1440) **avant la phase 2**.

## 4. Étapes

**Phase 1 · API** (une PR)
1. Prisma, migration additive : `UserPushDevice` (`userId`, `endpoint` unique, `p256dh`, `auth`,
   `userAgent`, `createdAt`, `lastSuccessAt`) ; sur `User` : `pushMutedTypes PushAlertType[]`,
   `pushQuietStart Int?`, `pushQuietEnd Int?` (minutes depuis minuit, Paris).
2. `modules/push/` : `PushDeliveryService` extrait de `AdminPushService.deliver` (envoi, 404/410,
   journal par hôte), réutilisé par l'admin sans changement de comportement.
3. `TraderNotifier.notify(userId, type, message, { accountId, dedup })` : ne lève jamais, rend la
   main tout de suite ; filtre démo, plan, type coupé, heures silencieuses, anti-spam.
4. Routes `/push/*` (JWT, démo bloquée par `DemoReadOnlyGuard`) : `public-key`, `subscribe`,
   `unsubscribe`, `devices` (liste), `DELETE devices/:id`, `PATCH preferences`, `test`.
5. Branchements : `PropAlertsService`, `TiltAlertsService`, `BehaviorAlertsService`, récap du jour.
6. Tests : filtres du notifier un par un, anti-spam, heures silencieuses à cheval sur minuit,
   410 → suppression, démo jamais servie, admin inchangé.

**Phase 2 · App** (après la maquette)
`push-sw.js`, manifest, icônes, `PushService` (permission demandée seulement au clic), section
profil, aide iOS, tests, captures 390 et 1440. **Désabonner l'appareil à la déconnexion**
(`POST /push/unsubscribe`, revue #717 m2) : sinon, sur un navigateur partagé, le trader précédent
reçoit ses alertes jusqu'à ce que le suivant s'abonne. Politique de confidentialité : paragraphe sur
l'enregistrement d'un appareil à publier avec la phase 2 (proposé dans la revue de #717).

**Phase 3 · Démo et docs**
Seed démo : un appareil fictif et des préférences pour que la section soit représentative (aucun
envoi possible : démo exclue). Agents `nestjs`, `prisma`, `angular`, `plans`, `deploy` (nginx,
variables), `security`, `tests` ; note de version. Essais réels sur appareils par Greg : iOS (PWA
installée), Android, Chrome, Firefox, Safari.

**Phase 4 · Veille serveur** (si 3.1 B retenu), avec test de charge.

## 5. Hors périmètre

Annonces, e-mail, autopsie (#669) en push, toute action sur Tradovate (lecture seule, clause 2i),
tout appel IA.

## 6. Décisions de Greg (2026-10-23)

1. Branche depuis `dev` (le ticket et CLAUDE.md disent `beta` : incohérence signalée à Greg).
2. Plans inchangés. Ajout validé à proposer : notification « connexion Tradovate à renouveler »
   (type `CONNECTION`, gratuit), codée en phase 1.
3. Types comme proposés en 3.3. Une limite franchie part toujours au moins une fois, malgré
   l'anti-spam (`force`), mais pas pendant les heures silencieuses ni si le type est coupé.
4. Heures silencieuses dans le fuseau de l'utilisateur s'il existe : **aucun fuseau n'est enregistré
   en base**, donc heure de Paris (`PUSH_TIME_ZONE`). `inQuietHours` prend déjà le fuseau en paramètre.
5. Service worker écrit à la main, push seulement, sans cache. Installabilité à confirmer avant la
   phase 2 (section 7.1).
6. Synchro de fond de 15 min : à évaluer (section 7.2). Phase 4 (suivi pendant la séance, app
   fermée) à décider après usage.

## 7. Évaluations

### 7.1 Installabilité Chrome Android avec un service worker sans `fetch`

D'après la documentation Chrome :
- **Installation par le menu** (« Installer l'application » / « Ajouter à l'écran d'accueil ») : plus
  besoin d'un service worker avec gestionnaire `fetch` depuis Chrome 108 sur Android (112 sur
  ordinateur). Il faut HTTPS et un manifest avec `name` ou `short_name`, icônes 192 et 512,
  `start_url`, `display` standalone (ou fullscreen, minimal-ui), `prefer_related_applications` absent.
- **Invite automatique** (bannière, `beforeinstallprompt`) : le billet Chrome de référence (mis à jour
  le 2023-12-05) indique qu'elle exige **encore** un gestionnaire `fetch`, et que Chrome ignore les
  gestionnaires vides. La page web.dev des critères ne mentionne plus de service worker : les deux
  sources ne disent pas la même chose.
- **Essai du 2026-10-23, Chrome 154 sur PC (Linux)**, deux pages de test locales identiques (manifest
  complet, icônes 192 et 512, `display: standalone`) : avec un service worker **sans** `fetch`,
  `beforeinstallprompt` arrive environ 1 s après l'enregistrement du service worker ; avec un `fetch`
  qui transmet seulement au réseau (`event.respondWith(fetch(event.request))`, aucun cache), même
  résultat. Le panneau Application > Manifest des DevTools n'est pas accessible depuis
  l'extension de pilotage : le constat repose sur l'événement lui-même. Non vérifié sur Android.
- **Conséquence** : avec notre service worker sans `fetch`, l'app est installable par le menu ; le
  bouton « Installer » piloté par `beforeinstallprompt` marche sur PC, sans garantie sur Android.
  Phase 2 : service worker sans `fetch` ; bouton « Installer » affiché seulement quand
  `beforeinstallprompt` est reçu, sinon texte d'aide en repli (« menu ⋮ puis Installer
  l'application ») ; vérification sur un vrai Android avant la mise en ligne. Si Android ne déclenche
  pas l'événement, le `fetch` de transmission seule est l'option suivante (aucun cache). iOS ne dépend pas de ce critère (partage, puis « Sur
  l'écran d'accueil »).

### 7.2 Alertes prop firm depuis la synchro de fond (15 min)

- **Possible sans appel Tradovate en plus.** Le cron `TradovateBackgroundRefreshCron` (toutes les
  15 min, utilisateurs dont l'app est fermée, connexions non synchronisées depuis 12 min) appelle déjà
  `TradovateSyncService.sync`, qui relit positions, trades et **solde** (`captureSnapshot`). Il suffit
  d'appeler `PropAlertsService.check` après chaque synchro de fond réussie : il ne lit que la base
  (`AccountsService.list`). Marqueur « push envoyé » distinct du marqueur
  « affichée dans l'app » (revue #717, I3) : l'alerte relevée en fond s'affiche quand même à
  l'ouverture, sans second push.
- **Coût Tradovate actuel, inchangé** : par connexion et par passage, 4 appels sans nouveau trade
  (`/account/list`, `/position/list`, `/fillPair/list`, solde) et environ 9 avec des trades (fills,
  frais, contrats, échéances, produits), soit environ 400 à 860 appels par connexion et par jour.
  Coût ajouté : 0 appel Tradovate, une lecture `AccountsService.list` par connexion et par passage.
  Descendre à 5 min triplerait les appels (environ 1 150 à 2 600 par jour et par connexion) :
  déconseillé.
- **Ce qui ne suit pas** : l'anti-tilt et les détecteurs de comportement jugent l'ENTRÉE au moment
  où elle arrive ; vus 15 min après, ils n'ont plus de sens (déjà exclus du rattrapage à l'ouverture).
  Seules les alertes de règles (`PROP_RULES`) passeraient par la synchro de fond.
- **Texte honnête** : même phrase, suivie de « Relevé de la synchro automatique, jusqu'à 15 min de
  décalage. » ; dans l'app, « app fermée : alertes de règles avec jusqu'à 15 min de décalage ».
- **Précautions** : ne pas écrire le journal de séance « vue en direct » (#373) ni créer d'incident
  `live` (#669) depuis ce chemin ; garder le relevé seulement pour le push.
- **Validé par Greg** (2026-10-23) et codé dans un commit séparé : drawdown, perte du jour, objectif et
  payout, comptes échoués ou archivés exclus.
