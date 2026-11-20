# Règles front détaillées : bundle, erreurs API, environnements, source design, polling

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Budget du bundle initial (règle du 2026-10-26) · 2026-10-26 -->
> **Origine** : `angular.md` · « Budget du bundle initial (règle du 2026-10-26) » · 2026-10-26

## Budget du bundle initial (règle du 2026-10-26)

- Plafond bloquant 500 ko (`project.json`, jamais relevé). **Tout ajout au bundle initial se mesure**
  (`nx run app-mytradingcoach:build:production`, ligne « Initial total ») avant/après, chiffre dans la PR.
- Sous le plafond de 500 ko : **marge cible 20 ko, alerte sous 10 ko : au-dessous, on s'arrête et on ouvre une PR budget**.
- Ce qui n'est pas au premier écran part à la demande : route `loadComponent`, `@defer`, `import()`.
  Un composant exporté par un barrel chargé au démarrage (`@mtc/front-ui`) reste dans le bundle
  initial même derrière `@defer` : l'importer par un chemin direct (ex. `@mtc/front-ui/confirm-dialog`,
  alias dans `tsconfig.base.json` ET `vitest.config.mts`).
- **Point sensible : la page d'inscription** est volontairement chargée d'office (fae5a8c8, −1,3 s en
  4G lente) et embarque `@angular/forms` (~43 ko) pour son formulaire. N'y toucher qu'avec l'accord
  de Greg (conversion des inscriptions).
- Polices : `src/styles/fonts.css` GÉNÉRÉ (`tools/scripts/generate-font-faces.mjs`), latin + latin-ext
  seulement ; `src/styles/fonts.spec.ts`. Verrous du chargement à la demande : `src/app/bundle-initial.spec.ts`.
- Mesures : 495,04 ko le 26/10 (`dev` ce2d8f2e) → 479,17 ko après le lot 1 (polices −13,19 ; page 404
  paresseuse −1,33 ; dialogue de confirmation à la première demande −1,35 ; `RouterOutlet` à la place
  de `RouterModule` dans `App` : 0, non retenu). Marge 20,83 ko.

<!-- Origine : angular.md · Gestion erreurs API · 2026-04-25 -->
> **Origine** : `angular.md` · « Gestion erreurs API » · 2026-04-25

## Gestion erreurs API

```typescript
// Toujours afficher err.error.message côté frontend
// Jamais "Internal server error" générique
this.aiService.insights().pipe(
  catchError(err => {
    this.errorMessage.set(err.error?.message ?? 'Une erreur est survenue');
    return EMPTY;
  })
)
```

### Suppressions : jamais de `subscribe` sans branche d'erreur

Trois échecs silencieux corrigés à ce jour, tous de la même forme — `subscribe({ next })`
sans `error`, ou un `error` qui ne fait que relâcher un spinner. L'utilisateur clique,
rien ne bouge, il conclut que l'app est cassée (« je rafraîchis la page il est toujours
dessus c'est normal ? », retour Discord). Points de contrôle :

- **Toute mutation a une branche `error` qui écrit un message affiché.** Repli lisible
  si le serveur n'en fournit pas — jamais `undefined` à l'écran.
- **Un `404` sur une suppression vaut succès** : la ligne n'est plus là, c'est
  l'objectif. La compter comme un échec affiche une erreur pour un but atteint et
  laisse à l'écran une ligne qui n'existe plus.
- **`forkJoin` s'arrête à la première erreur** et perd le sort des autres requêtes —
  qui, elles, ont abouti côté serveur. Pour une suppression en lot, encapsuler chaque
  requête (`map` + `catchError` → `{ id, parti }`) puis rendre compte du résultat réel :
  ce qui est parti disparaît, ce qui résiste est nommé. Sinon l'écran ment sur l'état
  du serveur jusqu'au prochain rechargement.

### Ne jamais figer un objet dérivé dans un signal

Une modale qui mémorise l'objet (`signal<DayGroup>`) au lieu de sa **clé** garde un
instantané qui se périme dès que la source change. Constaté sur le journal : la modale
annonçait « 22 trades » alors qu'il en restait 20, et rejouait des ids déjà supprimés.

```typescript
// ✅ la clé dans le signal, l'objet recalculé depuis la source vivante
readonly confirmDeleteDayKey = signal<string | null>(null);
readonly confirmDeleteDay = computed(() => {
  const key = this.confirmDeleteDayKey();
  return key === null ? null : this.tradesByDay().find(d => d.key === key) ?? null;
});
```

Corollaire : un message d'erreur lié à cette modale se nettoie via un `effect` sur la
**clé**, pas à la fermeture — il ne survit alors ni à la fermeture ni au passage sur un
autre élément, et l'écriture du message (clé inchangée) ne le rejoue pas.

Deux pièges de ce passage à la clé, tous deux dans le journal :

- **La fermeture après succès reste explicite.** On pourrait croire que la modale se
  referme d'elle-même puisque le groupe disparaît — c'est vrai d'une suppression, faux
  d'un déplacement : hors filtre par compte, la journée existe toujours après coup.
- **Prévoir le groupe devenu vide** entre l'ouverture et le clic : sans garde, on envoie
  une liste d'ids vide et le back répond un refus incompréhensible.

<!-- Origine : angular.md · Environments · 2026-04-25 -->
> **Origine** : `angular.md` · « Environments » · 2026-04-25

## Environments

```typescript
// environment.production.ts
export const environment = {
  production: true,
  apiUrl: 'https://api.mytradingcoach.app',
  appName: 'MyTradingCoach',
  appUrl: 'https://app.mytradingcoach.app',
  landingUrl: 'https://mytradingcoach.app',
};

// environment.ts  ← config par DÉFAUT en dev (il n'y a PAS d'environment.development.ts)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3001/api',   // 3001, pas 3000
  wsUrl: 'http://localhost:3001',
  appName: 'MyTradingCoach',
  appUrl: 'http://localhost:4200',
  landingUrl: 'http://localhost:4321',
};
```

Fichiers réellement présents : `environment.ts` (défaut dev), `environment.dev.ts`,
`environment.beta.ts`, `environment.production.ts` — substitués via `fileReplacements`
dans `project.json`. **L'API dev écoute sur 3001** : lancer `PORT=3001 pnpm nx serve
api-mytradingcoach`, sinon le front tape dans le vide. Les helpers e2e prennent la même
valeur par défaut (`E2E_API_URL`).

<!-- Origine : angular.md · Source de vérité design · 2026-07-08 -->
> **Origine** : `angular.md` · « Source de vérité design » · 2026-07-08

## Source de vérité design

Le miroir statique `app-mytradingcoach.html` a été **retiré** (commit `581875e`) — ne
plus s'y référer ni tenter de le synchroniser. La source de vérité du design c'est :
1. **le composant lui-même** (`*.component.html` / `.ts` inline + `.css`), aligné sur les
   tokens de `styles/theme.css` (« The Terminal » — cf. `.claude/agents/design.md`) ;
2. les **maquettes dédiées** du dépôt (`maquette-*.html`) et le projet Claude Design
   quand ils existent pour la vue concernée.

Règles design non négociables (détail dans `design.md`) : dark only, tokens CSS (jamais
de valeur en dur), chiffres/labels en `--font-mono` + `tabular-nums`, **icônes Lucide**
(jamais d'emoji dans les headers, vérifié par `src/app/titles-no-emoji.spec.ts` — seuls les émotions trader et watermarks décoratifs
sont tolérés), pas de barre d'accent `::before` sur les cartes de contenu. **Mise en page** : page sur toute
la largeur à droite de la barre latérale (aucun `max-width` de page, grille à colonnes
automatiques), défilement vertical seulement, vérifiée de 360 à 2560 px (règle complète dans
`design.md`). Page sans `mtc-topbar` : classes communes `.mtc-page` / `.mtc-page-head` /
`.mtc-page-title` / `.mtc-cards` de `styles.css` (alignement du titre sur le burger mobile), jamais de
padding ni de `max-width` sur le conteneur dans le CSS du composant.

<!-- Origine : angular.md · Polling : `visibleInterval` obligatoire (SCA-B4, 2026-10-01) · 2026-10-01 -->
> **Origine** : `angular.md` · « Polling : `visibleInterval` obligatoire (SCA-B4, 2026-10-01) » · 2026-10-01

## Polling : `visibleInterval` obligatoire (SCA-B4, 2026-10-01)

Test de charge B9 : le polling faisait **la moitié** des requêtes de l'API. Règles :
- **Jamais `interval()` / `setInterval()` pour interroger l'API** : `visibleInterval(ms)`
  (`core/utils/visible-interval.ts`) — muet onglet caché, une émission de rattrapage au retour si
  une période a été manquée. Délais centralisés dans `core/constants/polling.const.ts`.
- **Donnée commune à tous** (contexte marché, calendrier éco) → **poussée par le socket `/eco`**
  (`EcoSocketService.marketContext$`, `newReleases$`), polling HTTP en **secours à 5 min**
  seulement, et rattrapage à chaque (re)connexion (`connected$`).
- Le socket `/eco` est piloté par **`SessionStore`** (connecté tant que la session est active,
  quelle que soit la page), plus par `session-live`.
- `/auth/me` : 5 min (`USER_SYNC`), et au retour sur l'onglet seulement si la dernière synchro
  date de plus d'une minute.
- Budget vérifié par `session.store.polling.spec.ts` : **< 3 requêtes/min par onglet en session**
  (hors quick-trade), **0 onglet caché**. Toute nouvelle donnée périodique doit tenir ce budget.
- **Admin** : `visiblePoll(request, { periodMs })` (`apps/admin-mytradingcoach/src/app/core/utils/visible-poll.ts`) :
  aucune requête onglet caché (une tout de suite au retour), espacement ×2, ×4, ×8 après échec, jamais
  deux requêtes en parallèle ; émet `{ ok, value | error }` sans terminer le flux. Utilisé par
  Surveillance (15 s, bandeau `VPS_UNREACHABLE`, boutons masqués si `readOnly`) et le dashboard (VPS 10 s,
  connectés 30 s). Une erreur émise ne s'ignore jamais : hors 503, Surveillance garde les dernières données
  mais affiche un bandeau avec l'heure de la dernière lecture réussie (#1065, A22).
- **Écran admin en erreur** : jamais un état vide trompeur (« Aucune campagne », « 0 destinataire »,
  « Aucune fiche », chiffres de l'autre mode) à la place d'une erreur. Liste principale →
  `mtc-error-state` (`@mtc/front-ui`) avec Réessayer ; bloc secondaire → message `err-text`
  `role="alert"`. Un rechargement vide d'abord le bloc, et une réponse arrivée après un changement de
  paramètre (page, mode, sélection) est ignorée (#1065).
- **Renouvellement du jeton** (`libs/front/auth` `jwt-refresh.interceptor.ts`, app et admin) : un seul
  refresh partagé, `AuthRefreshState.refresh(auth)` (`shareReplay`, `refCount: false`) : les 401
  arrivés pendant qu'il est en vol le rejoignent, et il ne dépend d'aucune requête. Une requête
  annulée (écran quitté) se désabonne seule : le refresh va au bout, le jeton est gardé, le cookie de
  refresh n'est jamais présenté deux fois (#1103 ; avant, il était coupé avec la requête d'origine).
  Un refus d'authentification (401, ou 403 du refus de rôle admin) déconnecte une fois ; une erreur
  passagère (5xx, 429, réseau) ne déconnecte pas (#1145). Dans les deux cas, les requêtes en attente
  échouent avec l'erreur du refresh (#1065), et le 401 suivant relance un refresh ; une erreur de la
  requête rejouée ne déconnecte pas. Comme le refresh va au bout sans personne pour l'attendre, chaque
  service d'auth (app et admin) a un compteur `session` incrémenté par `logout()` : une réponse de
  refresh arrivée après la déconnexion est ignorée (rien réécrit, rien émis). Admin : `AdminAuthService.refreshToken()` refuse un compte non
  ADMIN (ou une réponse sans utilisateur), comme le login A18 : rien n'est gardé, l'intercepteur
  déconnecte (#1103).
- **Tout nouveau socket** (`io(...)`) étale ses reconnexions avec `...SOCKET_RECONNECT_OPTIONS`
  (`core/services/socket-reconnect.ts`, SCA-B4-07) : 1er essai entre 1 et 9 s, plafond 60 s. Sans ça,
  tous les onglets reviennent ensemble après un redémarrage de l'API.
- **Socket authentifié** (`/eco`, `/tradovate-live`) : `auth: (cb) => cb({ token: localStorage… })`
  (fonction : jeton relu à chaque reconnexion), garde `if (this.socket) return;` dans `connect()`, et
  nouvel essai espacé sur `disconnect` avec la raison `io server disconnect` (socket.io ne retente
  pas seul après un refus du serveur).
- **Dashboard** : les `effect` qui rechargent les analytics « après un nouveau trade / compte »
  ignorent tout tant que le store n'est pas `loaded()` (SCA-B4-04) : le premier chargement 0 → N
  n'est pas un ajout. Même garde pour toute réaction « le compteur a bougé ».
