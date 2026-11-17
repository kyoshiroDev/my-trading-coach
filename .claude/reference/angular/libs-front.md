# Libs front partagées (`libs/front/*`)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Libs front partagées (`libs/front/*`, audit du 27/09/2026) · 2026-09-27 -->
> **Origine** : `angular.md` · « Libs front partagées (`libs/front/*`, audit du 27/09/2026) » · 2026-09-27

## Libs front partagées (`libs/front/*`, audit du 27/09/2026)

| Lib | Import | Contenu |
|---|---|---|
| `libs/front/ui` | `@mtc/front-ui` | `foundations.css` (échelles, focus clavier, mouvement réduit, `.sr-only`), `ConfirmService` + `<mtc-confirm-dialog>`, `<mtc-error-state>`, directives `mtcDialog` et `mtcScrollMemory` |
| `libs/front/auth` | `@mtc/front-auth` | `jwtRefreshInterceptor` + jeton `AUTH_TOKEN_SOURCE` |

- **Jamais `window.confirm()`** : `await inject(ConfirmService).ask({ title, message, danger })`.
  Le dialogue est monté une fois dans la racine (app et admin).
- **Toute modale** porte `role="dialog" aria-modal="true" mtcDialog (mtcDialogClose)="fermer()"` sur
  la boîte (pas sur le fond) : focus envoyé dedans, Tab piégé, Échap ferme, focus rendu à la
  fermeture. Titre relié par `aria-labelledby`. Ne pas recoder ce comportement à la main.
- **Routeur** : `withInMemoryScrolling` (app et admin) + préchargement : admin `PreloadAllModules` ;
  **app `AuthenticatedPreloading`** (`core/auth/authenticated-preloading.ts`, oct. 2026) : rien pour un
  visiteur anonyme, et pour un connecté seulement une fois le navigateur inactif (`whenIdle`,
  `requestIdleCallback`, repli 1,5 s sur Safari). Avant, `PreloadAllModules` faisait télécharger 35
  chunks (270 Kio) du tableau de bord à un visiteur de /register, en concurrence avec le formulaire.
  Le shell connecté défile dans un conteneur (`<main>` / `.content`), pas la fenêtre :
  `mtcScrollMemory` sur ce conteneur remet en haut à chaque page et restaure la position au bouton
  « Précédent ».
- **`/register` sans import paresseux** (`component: RegisterComponent` dans `app.routes.ts`) : page
  d'arrivée des pubs. L'import paresseux ajoutait 2 allers-retours en cascade (chunk de la page, puis
  ses dépendances), ≈ 1,3 s en 4G lente. Coût : +12,8 Ko gz au bundle initial (≈ 474 kB bruts, au-dessus
  de l'avertissement 450 kB, sous le budget bloquant 500 kB). `/login` reste paresseux : le passer en
  direct ne coûterait que +0,6 Ko gz mais 9 kB bruts de marge sur le budget. Ce qui est importé par
  l'inscription arrive au démarrage : **pas de `@lucide/angular`** dedans (œil du mot de passe :
  `mtc-eye-icon`, SVG en ligne, partagé avec la connexion).
- **Mise en page de `/register` et `/login`** (oct. 2026, maquette `maquettes/maquette-register-split.html`) :
  `features/auth/auth-layout/`. `mtc-auth-layout` porte la page ; la page projette le contenu de la
  carte (titres, Google, formulaire), le layout ajoute le logo (< 1024 px seulement) et la ligne de
  confiance en bas de carte (« Lecture seule, aucun ordre passé · Hébergé en France » puis
  « Référencé dans l'écosystème NinjaTrader », texte seul, sans lien). Styles communs de la carte :
  `auth-form.css` (dans les `styleUrls` des deux pages). < 1024 px : carte seule (en haut sur
  téléphone, centrée de 600 à 1023 px). ≥ 1024 px : deux colonnes, présentation à gauche, formulaire
  sur `--bg-2` ; version compacte jusqu'à 1279 px.
  - **Colonne de présentation `mtc-auth-pitch`** (+ aperçu `mtc-auth-preview`, statique, données de
    démonstration, aucun appel API) : importée à la demande seulement quand `(min-width: 1024px)`
    est vraie (jamais sur téléphone), par `import('../login.component')` : `login.component.ts`
    réexporte `AuthPitchComponent` pour que la colonne voyage dans le morceau déjà paresseux de
    `/login`. Un morceau à part (ou `@defer`) scindait le chunk partagé d'Angular : +2,7 kB au bundle
    initial (488,4 kB sur 500 depuis #692, oct. 2026). Ne pas importer la colonne en statique.
  - Points : `SIGNUP_PITCH_POINTS` (`@mtc/shared`, module `signup-pitch.ts` à part pour ne pas
    entrer dans le bundle initial avec `PLAN_BENEFITS`) ; nombre de firms `PROP_FIRM_COUNT`, tenu égal
    à `PROP_FIRM_CATALOG_FILES.length` par un spec (le catalogue fait 1,8 Mo de JSON).
  - Mot de passe et confirmation **empilés à toutes les largeurs** (#967, plus de rangée côte à côte
    ni de `.pw-row`), comme les autres champs. Bouton « Explorer la démo, sans compte »
    (`routerLink="/demo"`, `data-testid="register-demo"`) seulement dans le parcours gratuit (ni
    `offerFlow`, ni Premium).
  - Desktop sans défilement (#970) : `<mtc-auth-layout class="signup">` (réglages propres à
    l'inscription par `:host(.signup)`, la connexion n'est pas touchée). ≥ 1024 px : case de
    consentement sur 2 lignes, offre d'essai collée au bouton. `(min-width: 1024px) and
    (max-height: 1079px)` : champs 38 px, écarts réduits, carte remontée (20 px) ; palier à 1079
    car la carte complète (995 px + marges) déborde sous 1075 px de haut. Mention légale
    UNIQUE sous le bouton principal (« En continuant (Google ou e-mail)… », variante `email`) ; celle
    du bouton Google n'est masquée qu'en `(min-width: 1024px) and (min-height: 760px)`, où la
    mention commune est visible sans défiler avant le clic Google (#745). Mobile : les deux restent.
    Colonne de présentation (975 px de haut naturels à ≥ 1280 px) : marges verticales 28/32 px au
    lieu de 40/44 (28/44 entre 1024 et 1279 px), palier `max-height: 1000px` (accord de Greg), via
    `:host-context(.signup)` dans `auth-pitch`.
  - Lien de parrainage (#976) : `[class.with-referral]="!!referralCode()"` sur le gabarit. ≥ 1024 px :
    encadré « Invitation » compact (12 px, padding 6/10, texte inchangé). `(min-width: 1024px) and
    (max-height: 1199px)` : carte resserrée en plus (écarts 6 px, libellés 4 px, marges de page 12 px,
    carte 18/16) ; sans code, rien ne change. Page = fenêtre de 960 à 1300 px de haut avec un code de
    4 à 20 caractères.
  - `/forgot-password`, `/reset-password` et la finalisation Google gardent l'ancien gabarit carte
    seule (`auth-layout/card-page.css`, `card-page-signup.css`), à migrer si besoin.
- **Écran de chargement** (`#mtc-boot`, `index.html`) : logo et « Chargement… » statiques, style
  intégré (tokens de `theme.css` avec valeurs de repli), visibles dès le HTML. Texte en police
  monospace **système** : JetBrains Mono y ferait télécharger une police en concurrence avec le JS. Retiré par `App`
  (`removeBootScreen`) après le rendu de la PREMIÈRE page (fin de navigation + `afterNextRender`), pas
  au démarrage d'Angular, sinon une page paresseuse laisserait un écran vide. Jamais d'écran vide.
- **Bundle initial < 500 kB (budget bloquant)** : `@lucide/angular` est un seul module ; si un
  composant chargé au démarrage (racine, toasts, dialogues globaux, **inscription**) l'importe, TOUTES
  les icônes de l'app partent dans le bundle initial (+226 kB). Au démarrage : SVG en ligne (cf. `toasts`,
  `mtc-eye-icon`).
- **Stores d'un utilisateur vidés au logout par `UserScopedReset`** (`core/auth/user-scoped-reset.ts`,
  #692) : chaque store s'inscrit dans son constructeur (`inject(UserScopedReset).register(() =>
  this.reset())`), `AuthService.logout()` appelle `resetAll()`. **`AuthService` (chargé au démarrage)
  n'importe aucun store ni API métier** : avant, il injectait `SelectedAccountStore`, `TradesStore` et
  `SetupsStore`, qui partaient au démarrage avec leurs API (−9,4 kB, 497,8 → 488,4 kB). Nouveau store
  propre à l'utilisateur → s'inscrire là, pas l'injecter dans `AuthService`. Reste au démarrage ~4,5 kB
  de `@mtc/shared` (règles prop firm, stats) via un morceau partagé d'esbuild, sans import direct.
  Inscrits (audit #994) : trades, setups, comptes, push, **séance** (`SessionStore` : `activeSession`
  à null coupe aussi ses pollings) et **Tradovate** (`TradovateStore`, `loaded` repasse à false).
- **Store qui recharge une liste filtrée** : génération incrémentée à chaque `loadTrades`, réponse
  d'une génération passée ignorée (`TradesStore`, #994) — sinon « Win » puis « Loss » rapides ou
  « Charger plus » puis un filtre affichent la réponse arrivée en dernier. Supprimer le trade qui
  sert de curseur recale `nextCursor` sur le dernier restant.
- **Suppression irréversible d'une ligne** : `ConfirmService.ask({ danger: true })` avant l'appel
  (croix du journal, #994), comme la suppression d'une journée.
- **Liste vide** : distinguer erreur (`mtc-error-state`), filtre sans résultat (« Tout afficher ») et
  vraie absence de données (`JournalComponent.emptyKind`, #994).
- **Schéma zod d'un formulaire** : il retire les clés qu'il ne connaît pas ; tout champ saisi doit y
  figurer (les frais du formulaire de trade ne partaient pas, #994). Ne jamais réécrire l'état du
  formulaire avec la valeur transformée pour l'envoi (le 2e envoi plantait).
- **Retour à la page demandée après connexion** (`core/auth/return-url.ts`, #994) : `authGuard`
  mémorise `state.url` dans `sessionStorage` (`mtc.returnUrl`), `PostSignupService.afterLogin()`
  (e-mail ET Google) y revient par `navigateByUrl`, sinon `/dashboard`. Liste blanche dans
  `isSafeReturnUrl` (cf. security.md). Spec d'un garde : routeur de test AVEC la route `login`,
  sinon rejet non géré qui fait sortir la suite en erreur.
- **Séance du jour** (#994) : l'onglet suit le statut de la séance (effet du constructeur), jamais
  posé à la main après `startSession` / `closeSessionThenDebrief` (sinon « Live » même en échec) ;
  pré-remplissage humeur / notes UNE fois par séance, lectures `untracked` ; la sauvegarde différée
  du journal part au `ngOnDestroy` si elle est en attente. `SessionStore.starting` verrouille
  « Démarrer » jusqu'à la réponse (double clic = 2 séances).
- **`SelectedAccountStore.loadError`** (#994) : une erreur de chargement garde les comptes déjà
  connus (plus de `accounts.set([])`) ; Mes comptes montre `mtc-error-state` s'il n'en connaît aucun.
- **Mes comptes** (#994) : suppression = toast « supprimé » / « archivé » selon la réponse, puis
  `refreshAfterImport()` (comptes + trades), 404 = succès ; Tradovate « À reconnecter » propose
  Déconnecter, et la branche de confirmation passe AVANT le statut dans le template ; la modale de
  connexion écoute `window:pageshow` (page restaurée du cache après « Précédent » → plus bloquée).
- **Auth** (#994) : login 400 (DTO) = « Email ou mot de passe incorrect » ; mot de passe oublié :
  succès seulement sur 204, sinon message (429, 400, panne).
- **Profil** (#994) : refus de l'API affichés (setups, nom, mot de passe, actifs) ; « SUPPRIMER »
  comparé sans casse ni espaces, champ en `autocapitalize="off"` / `autocorrect="off"`.
- **Historique des séances** (#994) : groupes par lundi de la semaine (avec l'année, jamais le seul
  n° ISO), 200 séances par mois (plafond de l'API).
- Dans les libs, sorties en `@Output() … = new EventEmitter()` : leurs tests tournent en JIT, qui
  ne voit pas `output()`.
- **Toute donnée chargée affiche son échec** : `@if (loadError()) { <mtc-error-state (retry)="reload()" /> }`
  avec `loadError = computed(() => !!resource.error())` (Dashboard, Analytics, Scoring en exemple).
- **Paiement** : `inject(BillingService).startCheckout(plan, { cta, promo })`
  (`core/services/billing.service.ts`), jamais `BillingApi.checkout` directement. Il ouvre la
  **page de paiement de l'app** `/paiement?plan=…&cta=…&promo=…` (`features/checkout/`, hors coque,
  `authGuard`), commune à TOUTES les offres (fondateur, code partenaire, Premium avec ou sans essai,
  mensuel ou annuel). La page appelle `BillingService.createSession` (`ui: 'elements'`), monte le
  formulaire Stripe (Checkout Elements, `@stripe/stripe-js` épinglé 9.17.0 = Stripe.js `dahlia`) :
  Apple Pay / Google Pay / Link en boutons express, carte (CB co-badgée reconnue) et Klarna dans le
  formulaire. Textes par offre : `checkout-copy.ts` (fonction pure, testée) ; montant du jour lu dans
  la session. Après paiement : `/dashboard?checkout=success`, traité au niveau de l'app par
  `CheckoutReturnService` (appelé par `App` à chaque navigation, une fois par chargement) : toast,
  `/auth/me` relu à 0 / 2,5 / 5 / 10 s jusqu'à voir l'abonnement, offres rechargées, puis `checkout`
  et `session_id` retirés de l'URL (B2 #1013 ; le Profil n'a plus de bandeau). `/paiement` ne capture
  jamais d'intention d'offre (B7). Confirmation express refusée (paiement en cours, rejet de
  `actions.confirm`) : toujours `paymentFailed`, bouton rendu (B16). Si l'API renvoie `{ url }` (clé
  publiable absente), repli sur la page Stripe. Hauteur du formulaire figée après chargement
  (passer à Klarna ne fait rien bouger) ; colonne gauche collante en desktop.
  **Boutons express** (#818) : ils arrivent 3 à 7 s après le formulaire carte. Leur zone
  (`.express`, 52 px + séparateur « ou par carte ») est réservée dès le chargement, avec un
  squelette (`pending`), et retirée seulement si Stripe ne propose aucun moyen express ou ne se
  charge pas (`loaderror`). `.express-host` en `display: flow-root` : le bloc Stripe a des marges
  de −4 px. Ne jamais créer la session plus tôt pour gagner du temps : chaque création réserve une
  place fondateur 35 min.
  **Formulaire posé avant affichage** (#829) : Stripe redimensionne encore le formulaire carte après
  son `ready` (332, 344 puis 416 px à 360 px ; la hauteur finale dépend de la largeur : 273 à 760 px,
  344 en desktop), et seulement une fois son cadre affiché. Le formulaire reste donc visible pour
  Stripe mais recouvert par « Préparation du paiement… » (panneau opaque hors du flux, jamais
  `visibility: hidden` sur `.payment`), total, bouton et mentions invisibles, jusqu'à 1,2 s sans
  changement de hauteur (`ResizeObserver`, plafond 5 s). En mobile, les avantages (sous le panneau)
  sont masqués pendant ce temps et l'en-tête réserve la hauteur du vrai texte (310 / 288 px). Page
  alignée en haut à distance fixe, plus centrée verticalement. Mesuré sur le banc : CLS ≤ 0,0014
  de 360 à 1024 px.
- **Contrastes** : texte blanc sur un fond plein → `background: var(--primary)` (survol
  `--primary-hover`), jamais `var(--blue)` / `var(--blue-bright)` (trop clairs sous du blanc).
  Verrouillé dans l'app par `src/app/contraste-fonds-bleus.spec.ts` (#1085) : aucun texte clair
  (`--text*`, blanc) dans une règle à fond `--blue` / `--blue-bright` plein, et Payer, cadenas Premium,
  partage de résultats, assistant de plan et plan en séance live sur `--primary` / `--primary-hover`.
- Les couleurs restent propres à chaque app : l'admin suit sa maquette (teal, Geist), seules la
  structure et l'accessibilité sont partagées.
- Tests : `pnpm nx test front-ui` / `pnpm nx test front-auth` (config Vitest propre à chaque lib :
  l'exécuteur de l'app refuse les specs hors de sa racine). Une lib importée par l'app doit aussi
  être déclarée dans `resolve.alias` de `apps/app-mytradingcoach/vitest.config.mts`.
