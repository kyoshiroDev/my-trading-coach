# Acquisition UTM et parcours d'inscription par source

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Acquisition UTM (oct. 2026) · 2026-10-02 -->
> **Origine** : `nestjs.md` · « Acquisition UTM (oct. 2026) » · 2026-10-02

## Acquisition UTM (oct. 2026)

- `POST /auth/register` accepte `acquisitionSource` / `acquisitionMedium` / `acquisitionCampaign`
  (optionnels, ≤ 100 car., trim + minuscules dans `RegisterDto`, vide → absent). **Déployer l'API
  avant l'app** : `forbidNonWhitelisted` rejette en 400 tout champ inconnu.
- `GET /admin/acquisition` (`AdminService.getAcquisition`, contrat `AdminAcquisitionData` de
  `@mtc/shared`) : une requête SQL groupée par source, hors `isDemo` et hors ADMIN. Premium =
  `stripeSubscriptionStatus IN ('active','trialing','past_due')`, `trialing` renvoyé à part.
  `source: null` = direct / non renseigné. Page admin : `/acquisition` (nav Business).
- **Inscrits d'une campagne (#625)** : `GET /admin/users?source=&medium=&campaign=`
  (`AdminListQueryDto`, normalisés comme `RegisterDto`) filtre à l'**égalité exacte** ; paramètre
  absent = ignoré, `-` (`UTM_NONE`, `@mtc/shared` acquisition-filter) = non renseigné (null).
  `ADMIN_USER_SELECT` renvoie les 3 champs ; la fiche (`identity.acquisition`) aussi. Le récap
  quotidien des inscriptions (`signup-digest.cron.ts`) ajoute la provenance à chaque ligne
  (`instagram · dm · exemple`, sinon `direct`). La liste admin n'exclut pas les ADMIN (l'agrégat si).
- La réponse inclut aussi les **visites landing** (`visits7d/30d` par source, `daily` sur 30 j,
  `topPages`) lues dans `LandingVisitDaily`, et `campaigns` : le même détail par source + medium +
  campagne (50 lignes). Les deux niveaux sortent des mêmes requêtes groupées par (source, medium,
  campagne) ; `''` (visites) et `null` (inscrits) sont fusionnés en « non renseigné ». Le taux global visite → inscription ne compte que les
  sources ayant des visites (sinon les inscrits arrivés direct sur l'app le font dépasser 100 %).
- `POST /public/visit` (public, 60/min/IP, toujours 204) : `{ path, source?, medium?, campaign?, entry }`. Robots
  filtrés par User-Agent (`BOT_UA` dans `PublicService`), erreur base avalée et loggée.
  **Pas de cookie, pas d'IP stockée** (exemption CNIL) : ne pas y ajouter de donnée personnelle.
  `inApp?` (booléen, navigateur intégré Instagram/Facebook/TikTok détecté par la landing) : optionnel,
  absent → `false` (compatibilité avec une landing plus ancienne).

<!-- Origine : nestjs.md · Parcours d'inscription par source (oct. 2026) · 2026-10-14 -->
> **Origine** : `nestjs.md` · « Parcours d'inscription par source (oct. 2026) » · 2026-10-14

## Parcours d'inscription par source (oct. 2026)

- `POST /public/funnel` (`PublicService.recordFunnelEvent`, `FunnelEventDto`) : `step` ∈
  `SIGNUP_FUNNEL_STEPS` de `@mtc/shared` (`cta_click`, `register_view`, `register_submit`,
  `register_success`, `register_error`, `checkout_redirect`) ; **`landing_view` est refusé (400)** :
  la visite reste comptée par `/public/visit`. `source/medium/campaign` normalisés comme les visites
  (`dto/utm.transform.ts`, partagé). `detail` ramené par `signupFunnelDetail` (shared) à sa liste
  blanche : CTA `founder|free|premium` (cta_click), plan `founder|premium` (checkout_redirect), code
  `email_taken|validation|network|server|other` (register_error, inconnu → `other`), sinon `''`.
  Champ inconnu (ex. `email`) → 400 (`forbidNonWhitelisted`). Robots filtrés (`BOT_UA`), toujours 204,
  erreur base avalée. Upsert `INSERT … ON CONFLICT` +1 dans `FunnelEventDaily`.
  La landing envoie par `sendBeacon` en **`text/plain`** (requête simple, sans requête préalable
  CORS) : `config/body-parsers.ts` lit ce corps en JSON sur `FUNNEL_BEACON_PATH` SEULEMENT (2 ko max).
  Ailleurs, un `text/plain` n'est pas lu. Ne pas étendre ce parseur à d'autres routes. Depuis oct. 2026,
  l'app envoie aussi TOUTES ses étapes ainsi (`register_view` dès l'arrivée par un script inline
  d'`index.html`, puis `SignupFunnelService`) : plus aucun appel JSON sur cette route.
- **Engagement landing** (19/10/2026) : la même route accepte `FUNNEL_BEACON_STEPS` = étapes
  d'inscription + `LANDING_ENGAGEMENT_STEPS` (`scroll_depth` detail `25|50|75|100`, `time_on_page`
  detail `10|30|60`, `rules_use` sans detail) et `path?` (64 car. max). Le service ramène `path` à
  `LANDING_ENGAGEMENT_PAGES` (`/`, `/prop-firm`, `/` final retiré) : engagement hors page mesurée ou
  sans seuil reconnu → rien écrit ; étape d'inscription → `path = ''` quel que soit le corps. Le
  `ON CONFLICT` liste les 8 colonnes de l'unique, `path` compris.
- `GET /admin/landing-engagement` (`LandingEngagementService`, fusion pure `landing-engagement.util.ts`,
  contrat `AdminLandingEngagementData`) : pages vues (`LandingVisitDaily.pageviews`, base des taux)
  + événements d'engagement par (page, source, medium, campagne), navigateurs confondus ; `scroll` /
  `time` = tableaux dans l'ordre des seuils partagés. Tri page puis vues, 100 lignes max. Le
  parcours d'inscription (`buildSignupFunnelRows`) ignore ces étapes (hors `SIGNUP_FUNNEL_STEPS`).
- CORS (`main.ts`) : `maxAge: 600` (`Access-Control-Max-Age`) : le navigateur garde 10 min la réponse
  à la requête préalable au lieu d'en refaire une avant chaque appel JSON de l'app (un aller-retour en
  4G lente). Les origines autorisées restent `CORS_ORIGINS`.
- `GET /admin/signup-funnel` (`SignupFunnelService`, fusion pure `signup-funnel.util.ts`, contrat
  `AdminSignupFunnelData`) : visites (`LandingVisitDaily`) + étapes par (source, medium, campagne,
  inApp), `''` → `null` ; une source sans visite (arrivée directe sur l'app) a sa ligne. 100 lignes max,
  erreurs `register_error` par source × inApp × code (50 max). Compteurs d'événements, pas
  d'utilisateurs distincts ; aucune jointure `User`, donc ni démo ni compte. Les agrégats d'inscrits
  existants (`/admin/acquisition`, `/admin/funnel`) gardent leur exclusion `isDemo` / ADMIN.
- Pas de donnée personnelle (exemption CNIL, comme les visites) : ne jamais ajouter UA brut, e-mail,
  IP ni identifiant de session à ces routes ou à la table.
- `detail: 'demo'` (`SIGNUP_FUNNEL_ORIGINS`, #1029) accepté sur `register_view`, `register_submit` et
  `register_success` : inscription partie du bandeau de la démo (`/register?source=demo`). Le parcours
  admin additionne toujours les étapes quel que soit le `detail`.

<!-- Origine : angular.md · Parcours d'inscription par source (oct. 2026) · 2026-10-14 -->
> **Origine** : `angular.md` · « Parcours d'inscription par source (oct. 2026) » · 2026-10-14

## Parcours d'inscription par source (oct. 2026)

`core/services/signup-funnel.service.ts` → `POST /public/funnel` par **`navigator.sendBeacon` en
`text/plain`** (repli `fetch` keepalive `text/plain`) : pas de requête préalable CORS, et l'étape part
même si la page change juste après (`register_submit` avant la redirection, `checkout_redirect` avant
Stripe). Anonyme : étape, source/medium/campagne, `inApp`, detail d'une liste fermée de `@mtc/shared`.
L'API lit ce corps en JSON sur cette route seulement (cf. nestjs.md). Ne pas revenir à HttpClient.
- **`register_view` dès l'arrivée** (oct. 2026) : script inline `#mtc-register-view` d'`index.html`,
  exécuté au chargement de `/register` sur `app.`, `dev.app.` et `beta.app.mytradingcoach.app` (URL de
  l'API déduite de l'hôte), AVANT le téléchargement de l'app : un visiteur qui part pendant le
  chargement est compté. Origine = UTM du lien, sinon `mtc_utm` de l'onglet, sinon site d'origine
  (mêmes règles que `resolveAcquisition` / `referrerHost`). Rien n'est envoyé si connecté
  (`access_token` + `user` en localStorage) ni en mode interne (`?internal=1` ou `mtc_internal`).
  Il pose `window.mtcRegisterView` : `SignupFunnelService.start()` ne renvoie alors pas `register_view`
  pour ce chargement (pas de double comptage), mais l'envoie encore après une navigation interne
  (connexion → inscription) ou sur un hôte sans script (local). Motif `inApp` = `IN_APP_UA_PATTERN`
  recopié : `src/index-register-view.spec.ts` vérifie qu'il est identique, et l'URL de l'API de
  chaque `environment.*.ts`. Nouvel environnement déployé → l'ajouter au script ET au test.
- ⚠️ **Chiffres « Page inscription » avant / après** : depuis la mise en prod de ce correctif (branche
  `fix/fuite-clic-inscription`, commits du 2026-10-17), `register_view` est compté dès l'arrivée et
  non plus après le chargement de l'app (≈ 3,9 s plus tard en 4G lente) ; un utilisateur connecté qui
  ouvre /register n'est plus compté. Les taux clic → page d'avant et d'après ne sont pas comparables.
- `RegisterComponent` : `start(origine)` à l'ouverture (origine = UTM résolues par
  `resolveAcquisition`, gardée en sessionStorage `mtc_funnel` car `mtc_utm` est effacé après
  l'inscription ; `register_view` sauf si déjà envoyé par `index.html`), `register_submit` si le
  formulaire est valide côté client, `register_success`, `register_error` avec
  `registerErrorCode(status)` (409 `email_taken`, 400/422 `validation`, 0 `network`, ≥ 500 `server`,
  sinon `other`). Pas de `register_view` si l'utilisateur, déjà connecté, est renvoyé vers `/dashboard`.
- `BillingService.startCheckout` → `trackCheckout(plan)` = `checkout_redirect` (detail `founder` /
  `premium`), **seulement si l'onglet est passé par /register** (`mtc_funnel` présent) : un abonné qui
  paie depuis le Profil n'est pas une étape du parcours.
- **Mode interne** : `https://app.mytradingcoach.app/?internal=1` (n'importe quelle page) →
  localStorage `mtc_internal=1`, lu au démarrage par `App` (`captureInternal`) : plus aucune étape
  envoyée, badge « interne » en bas à gauche (`mtc-internal-badge`, monté dans `App`). `?internal=0`
  annule. Propre au domaine : la landing a le sien.
- **Admin `/acquisition`, carte « Parcours d'inscription »** (au-dessus de l'entonnoir Premium) :
  `GET /admin/signup-funnel?days=7|30` (`AdminApi.signupFunnel`), onglets `section-tabs` période (7 j / 30 j,
  rechargement) et navigateur (Tous / intégré / normal, filtrage local). Logique pure testée dans
  `features/acquisition/signup-funnel.util.ts` : « Tous » additionne intégré + normal d'une même
  source/medium/campagne, ligne Total, taux = étape / étape précédente (`-` si la précédente vaut 0),
  erreurs fusionnées par source + code avec libellé (`errorLabel`). Colonnes : Visites → Clics CTA →
  Page inscription → Envois → Inscrits → Checkout. Valeur + taux dans un même `span` (cartes mobiles).

- **Carte « Engagement landing »** (19/10/2026, sous le parcours d'inscription) :
  `GET /admin/landing-engagement?days=7|30` (`AdminApi.landingEngagement`), onglets période propres.
  Logique pure testée dans `features/acquisition/landing-engagement.util.ts` : une section par page
  (Accueil `/`, Prop firm `/prop-firm`, même vide) avec ligne Total puis lignes source · medium ·
  campagne. Colonnes `ENGAGEMENT_COLUMNS` : Vues · 25/50/75/100 % · 10/30/60 s · Règles, taux = valeur
  / vues de la ligne (pas l'étape précédente). Mêmes classes que le parcours (`signup-*`).
