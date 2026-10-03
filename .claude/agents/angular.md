---
name: angular
description: "Conventions de l'app et de l'admin Angular (signals, zoneless, libs front partagées, modales, erreurs, routes). À lire avant tout travail dans apps/app-mytradingcoach ou apps/admin-mytradingcoach."
---

# Agent Angular — app-mytradingcoach

## Stack
Angular 22 · Signals · Standalone Components · @lucide/angular · Vitest · Nx 23 · TypeScript 6.0

---

## Règles Angular 22 — ABSOLUES

- `@if` / `@for` / `@switch` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `DestroyRef` à la place de `ngOnDestroy`
- `signal()`, `computed()`, `effect()`, `toSignal()` — signals partout
- `@defer` pour le lazy loading des composants lourds
- Standalone Components exclusivement — pas de NgModules
- Prefix composants : `mtc-`
- Icônes : `@lucide/angular` exclusivement (jamais d'autres libs d'icônes). Motif :
  `<svg [lucideIcon]="XIcon" [size]="16" class="…" />` avec `LucideDynamicIcon` dans `imports`
  et `import { LucideX as X } from '@lucide/angular'` (le `<svg>` EST l'icône, classe `lucide`
  posée par la librairie → CSS sur `svg.lucide`, jamais sur `lucide-icon`). La librairie réécrit
  l'attribut `class` à chaque rendu : pas de `[class.x]` sur l'icône, passer par `[class]`.
- CSS dans `.css` uniquement — jamais inline dans `.ts`
- `OnPush` sur les composants sans signals

---

## Structure

```
src/app/
├── core/
│   ├── auth/       auth.service.ts · auth.guard.ts · auth.interceptor.ts
│   ├── api/        trades.api.ts · analytics.api.ts · debrief.api.ts · ai.api.ts
│   │               admin.api.ts · vps.api.ts
│   │               session.api.ts      ← V2 (TradingSession, LiveStats, SessionTrade, MoodState)
│   │               eco-calendar.api.ts ← V2 (EcoEvent, EcoCalendarData, EcoResultAnalysis)
│   │               daily-recap.api.ts  ← V2 (DailyRecap)
│   └── stores/     trades.store.ts · user.store.ts
│                   user.store : isBeta = computed(() => role === 'BETA_TESTER' || 'ADMIN')
├── features/
│   ├── dashboard/          dashboard.component.ts + .html + .css (état, cadre, états vides)
│   │   ├── dashboard-charts.util.ts   ← calculs purs des viz (sparklines, donuts, P&L, coach)
│   │   ├── panels/                    ← viz présentationnelles : dashboard-kpis · equity-chart ·
│   │   │                                top-assets · pl-bars · coach-feedback · donut-chart ·
│   │   │                                recent-trades-table
│   │   └── components/
│   │       ├── session-morning/  ← V2 : vue pré-session (mood, recap hier, objectifs, éco calendar)
│   │       │   session-morning.component.ts + .css
│   │       └── session-live/     ← V2 : vue session active (cadre + mini-stats)
│   │           session-live.component.ts + .css
│   │           └── components/   live-eco-calendar · live-feed · quick-trade · live-news
│   ├── journal/            journal.component · trade-form.component
│   │                       csv-import.component   ← import historique GRATUIT (tous plans)
│   │                       (register : « trades illimités, sans CB » ;
│   │                        levier d'acquisition, dispo onboarding + bouton CSV du Journal)
│   ├── analytics/          analytics.component · heatmap.component
│   ├── ai-insights/        ai-insights.component · insight-card.component
│   ├── weekly-debrief/     debrief.component · debrief-objectives · debrief-emotions
│   ├── scoring/            scoring.component
│   ├── profile/            profile.component (route /profil)
│   ├── today-session/      today-session.component (route /session)
│   └── auth/               login.component · register.component
├── shared/
│   ├── components/  sidebar/ · topbar/ · stat-card/ · badge/ · locked-feature/
│   └── pipes/       pnl-color.pipe.ts · pnl-format.pipe.ts · emotion-emoji.pipe.ts
│                    session-label.pipe.ts · setup-color.pipe.ts
├── app.component.ts
├── app.config.ts
└── app.routes.ts
```

### Imports

Au-delà de 2 niveaux de `../`, utiliser l'alias : `@app/core/…`, `@app/shared/…`, `@app/features/…`,
`@app/environments/environment` (admin : `@admin/…`). Déclarés dans `tsconfig.base.json` et dans
`resolve.alias` de `vitest.config.mts` (le plus précis en premier).

### URL → dossier

Les URLs restent en français (liens des emails, favoris) ; les dossiers sont en anglais.

| App — URL | Dossier `features/` | Admin — URL | Dossier `features/` |
|---|---|---|---|
| `/dashboard` | `dashboard` | `/dashboard` | `dashboard` |
| `/session` | `today-session` | `/users`, `/users/:id` | `users`, `user-detail` |
| `/journal` | `journal` | `/subscriptions` | `subscriptions` |
| `/sessions` | `sessions` | `/revenue` | `revenue` |
| `/accounts` | `accounts` | `/deleted` | `deleted` |
| `/analytics` | `analytics` | `/surveillance` | `monitoring` |
| `/ai-insights` | `ai-insights` | `/backups` | `backups` |
| `/debrief` | `weekly-debrief` | `/ai-usage` | `ai-usage` |
| `/scoring` | `scoring` | `/emails` | `emails` |
| `/eco-calendar` | `eco-calendar` | `/ambassadeurs` | `ambassadors` |
| `/profil` | `profile` | `/parrainage` | `referral` |
| `/ambassador` | `ambassador` | | |
| `/parrainage` | `referral` | | |
| `/devenir-ambassadeur` | `become-ambassador` | | |
| `/login`, `/register`, `/demo`… | `auth` | | |

### « Ma session » — route `/session` (générale, tous plans)

`today-session.component.ts` (features/today-session/) : shell à 3 onglets aligné sur
la maquette design (« The Terminal »).

```typescript
// activeTab = signal<'morning' | 'live' | 'debrief'>('morning')
// effect() auto-switch vers 'live' si activeSession()?.status === 'ACTIVE'
// Polling visibleInterval(30s) pour refreshLiveStats() pendant session active (SessionStore, SCA-B4)
```

- **Shell** : `mtc-topbar` en **mode hero** (`[heroHeader]="true"`) — titre « Ma session »
  + date · compte **empilés sur 2 lignes**, segmented control (icônes Lucide
  Sunrise/Activity/Moon) **centré sur la ligne du header** via le slot `[topbar-center]`,
  action à droite « Démarrer la session » (vert) / pill « Session active + timer » +
  « Clôturer ». La **sidebar se replie en icônes pendant qu'on regarde l'onglet Session
  live**, et seulement là : l'effet de `sidebar.component` suit
  `LiveModeService.isLive()`, posé par `session-day` sur `activeTab === 'live'` et retiré
  au changement d'onglet comme en quittant la route. Le déclencheur était
  `SessionStore.hasActiveSession()` — un état qui dure toute la séance, donc la sidebar
  restait repliée sur le Dashboard et le Journal, bien après avoir quitté le live. L'état
  d'avant est restauré en sortant, et le repli/dépli manuel tient (l'effet lit
  `collapsed()` dans un `untracked`, il ne se redéclenche pas). La préférence localStorage
  n'est jamais écrasée : `collapsed.set` ne l'écrit pas, seul `toggleCollapse` le fait.
- **Onglet Pré-session** → `session-morning.component` (features/dashboard/components/) :
  carte Prépare (mood/plan/compte projeté) + Hier + Objectifs · Agenda du jour IA.
- **Onglet Session live** → `session-live.component` : Contexte marché (cellules
  « Ticker (Descripteur) » + valeur/variation sur une ligne) + News (ticker horizontal)
  + **zone gauche** (4 mini-stats sur la largeur Calendrier+Live feed, puis Calendrier |
  Live feed) + **Trade rapide en colonne pleine hauteur à droite**. Live feed en **ligne
  compacte** : heure · asset · sens (▲/▼) · émotion (`emotionEmojiPipe`) · P&L / ● LIVE.
- **Onglet Débrief** (inline dans session-day) : 4 stats · analyse (mood fin, score de
  discipline, meilleur/pire trade, émotions, objectifs) · journal pleine hauteur à droite.

Le compagnon de session (pré-session + live + débrief de base) est **FREE** ; le gating
IA (contexte marché, news, calendrier éco IA, recap) suit `plans.md`. Données chargées
via `SessionStore` : `/session/active`, `/analytics/daily-recap/yesterday`,
`/eco-calendar/*`, `/debrief/current`, `/trades/market-context`, `/trades/news`.

### Wizard onboarding : checkpoint unique et z-index (PROMPT-198/199)

**Rien n'est persisté avant l'étape Stratégie.** Le wizard accumule ses choix dans des
signaux + un snapshot localStorage (`mtc.onboarding.progress`), et ne fait ses appels
réseau qu'à `saveProfileThenGoAssets()` — profil IA **puis** création du compte de
trading déclaré à l'étape 3. Toute nouvelle donnée d'étape suit ce schéma : signal,
champ dans `OnboardingProgress`, restauration dans `restoreProgress()`, envoi au
checkpoint. Ne pas ajouter d'appel réseau au clic « Continuer » d'une étape isolée.

**Le checkpoint est rejouable** : un retour arrière depuis l'étape Actifs puis une
ré-avance le redéclenche. Toute création faite là doit donc être idempotente. Pour le
compte de trading, deux filets : un flag mémoire (`accountCreated`, posé **avant**
l'appel, pour le double-clic) **et** un `getAll()` préalable — le flag seul ne survit ni
au rechargement, ni au localStorage vidé, ni à un second onglet. Chacun est couvert par
son propre test.

**Le compte est créé à l'onboarding, plus au premier trade.** `ensureDefaultAccountId`
(back) reste le filet, mais il produit un PERSONAL « Compte principal » sans règles :
c'est le mauvais compte pour la cible prop firm. L'étape 3 capture perso/prop firm,
broker, objectif et drawdown, tous optionnels — un `profitTarget: 0` n'est **pas**
envoyé, sinon « Mes comptes » affiche une barre d'objectif vide au lieu de masquer la
carte de règles.

**Un checkpoint qui échoue ne doit jamais avancer.** La branche `error` de
`saveProfileThenGoAssets` faisait `step.set(6)` comme la branche `next` : l'appel
échouait, le wizard avançait, l'utilisateur terminait avec un profil vide sans le
moindre signal (constaté en base sur dev). Règle : un appel réseau porteur de données
ne se solde jamais par une avancée silencieuse — on reste sur l'étape, on affiche
`err.error?.message` avec un repli lisible, et on offre **réessayer** *et* **continuer
quand même**. Bloquer serait aussi faux : le wizard doit toujours laisser sortir.

**Z-index — hiérarchie de l'app** : `300` overlay onboarding · `1000` modales
top-level (csv-import, plan-modal, setup-form-modal, session-live fullscreen) ·
`10000` toasts (`styles.css`). Une modale partagée ouverte **depuis** le wizard doit
être au palier 1000 : à 200, `setup-form-modal` s'ouvrait sous l'overlay et
« + Ajouter un setup » semblait mort. jsdom ne calcule aucun contexte d'empilement,
donc aucun test de rendu n'attrape ça — l'invariant est verrouillé en lisant les deux
CSS (`onboarding-friction.spec.ts`).

### Un défaut positionnel se réévalue dans ton dos (journal)

`isWeekCollapsed(key, index)` retombait sur `index !== 0` quand l'utilisateur n'avait
rien choisi : « seule la plus récente est ouverte ». Le défaut dépendait donc de la
POSITION, qui bouge. Logger un trade dans une semaine plus récente décalait la semaine
consultée de l'index 0 à l'index 1 et la repliait toute seule — le journal semblait se
vider au moment précis où on venait d'y ajouter quelque chose.

Règle : un état d'affichage dont le défaut dépend du rang dans une liste doit être
**figé à l'apparition de l'élément** (`freezeNewWeeks`), pas recalculé à chaque rendu.
L'override explicite de l'utilisateur reste prioritaire et n'est jamais écrasé.

### Stores : un compteur à 0 n'est pas une donnée (PROMPT-196)

`TradesStore` expose `loaded` **en plus** de `totalTrades`, comme `SelectedAccountStore`.
Sans lui, `totalTrades() === 0` était ambigu — avant tout chargement, PENDANT un
reset+recharge, et pour un compte réellement vide. Le dashboard lisait ce 0 comme
« compte vide » et affichait « Fais ton premier pas » juste après un import réussi :
l'utilisateur venait d'importer son historique et lisait « tu n'as rien fait ».

Règle : **ne jamais conclure « vide » depuis un compteur seul**. Un état vide se déduit
de `loaded() && total === 0`. Le dashboard passe par `accountReallyEmpty()`.
`loaded` ne passe à `true` que sur une réponse **reçue** (pas sur erreur) et retombe à
`false` dans `reset()` : après un échec ou pendant un rechargement, l'état est
« inconnu », jamais « il n'a rien ».

Corollaire pour l'auto-élargissement de la fenêtre : ne pas désarmer sur un compte vide
(`periodAutoAdjusted`), sinon l'import qui suit n'élargit plus jamais la période.

#### Hauteurs calées sur le viewport → `--demo-banner-h` (PROMPT-192)

Les 3 onglets se dimensionnent en `calc(100vh - 103px - var(--demo-banner-h, 0px))`
(≥981px). Le `103px` suppose que `.session-page` colle au haut du viewport — faux en
mode démo, où le bandeau « Mode démo » s'intercale dans `.main-content` : la vue
débordait de 52 px et créait un scroll parasite sur des écrans conçus pour tenir
dans la fenêtre.

`--demo-banner-h` est publiée par `.main-content.has-demo-banner` (sidebar.component.css),
vaut `0px` hors démo, et le bandeau a une **hauteur fixe égale à la variable**
(`flex: 0 0 var(--demo-banner-h)`, `flex-wrap: nowrap`) pour que l'offset ne puisse pas
mentir. Sous 768px : 40px, la phrase longue (`.demo-banner-long`) tombe, le CTA reste.

**Toute nouvelle vue calée sur `100vh` doit retrancher `var(--demo-banner-h, 0px)`.**

---

## Pipes obligatoires — ne jamais dupliquer la logique

```typescript
// Toujours utiliser les pipes, jamais de logique inline
PnlColorPipe      // couleur verte/rouge selon pnl
PnlFormatPipe     // montant signé dans la devise NATIVE du compte : {{ t.pnl | pnlFormat : t.entry : t.accountId }}
MoneyPipe         // idem avec décimales / sans « + » : {{ pnl | money:0 }}, {{ fees | money:2:false }}
EmotionEmojiPipe  // emoji selon état émotionnel
SessionLabelPipe  // label lisible de la session
SetupColorPipe    // couleur selon setup
```

**Devise = propriété DU COMPTE, ZÉRO conversion, AUCUNE préférence globale** (PROMPT-213/214) :
un montant s'affiche dans la devise de son compte de trading (`TradingAccount.currency`), tel que
reçu — un compte prop firm en USD s'affiche en USD pour tout le monde. Source UNIQUE front + back :
`@mtc/shared` (`libs/shared/src/currency.ts`) — `ACCOUNT_CURRENCIES` (USD, USDT, EUR : sélecteurs
de l'onboarding et de la page Comptes, validation API), `formatMoney(value, currency)` (`$1.00`,
`€1.00`, `1.00 USDT` : code APRÈS le montant pour les devises sans symbole), `commonCurrency`.
- **Totaux de l'écran** : `MoneyService.format()` / pipes → `SelectedAccountStore.displayCurrency`
  (compte sélectionné, sinon devise commune de « Tous les comptes »).
- **Ligne de trade** : devise de SON compte → passer l'`accountId` (`pnlFormat : entry : accountId`,
  `MoneyService.formatFor`). `Trade.accountId` est exposé par l'API.
- **Devises mêlées en « Tous les comptes »** (`MoneyService.mixed()`) : pas de totaux (on
  n'additionne pas des USD et des EUR) → `<mtc-mixed-currency-notice />` (« choisis un compte ») à
  la place des KPI / courbes / calendrier (dashboard, analytics, résumé et totaux jour/semaine du
  journal) ; les lignes de trades restent, chacune dans sa devise. Formateur avec devise `null` →
  aucun symbole, jamais un symbole deviné.
- **Compte synchronisé** : devise imposée par le broker, sélecteur désactivé (`formSynced`) et refusé
  côté API. Onboarding : le choix USD / USDT / EUR est la devise du compte créé, rien au profil.
- **`User.currency` / `User.currencyRate` n'existent plus côté front** (plus de réglage « Devise
  d'affichage », plus de taux) : ne jamais réintroduire de conversion. **Jamais de `$` en dur**
  dans un template, un graphe Chart.js (`ChartService`) ou un libellé calculé (récaps d'import
  compris : devise du compte cible).

**P&L affiché = net** : un montant par trade se lit via `netPnl(t)` de `@mtc/shared`
(`pnl` brut − frais), jamais `t.pnl` brut (tableau des trades récents, live feed). Les agrégats de
l'API sont déjà nets. Le formulaire de trade envoie le **brut** (`form().pnl ?? autoPnl()`) et la
commission à part : envoyer `pnlNet` faisait déduire les frais deux fois.

**Courbe d'équité / drawdown** : `ChartService` préfixe un point « Départ » (capital de base,
drawdown 0) : un seul jour tradé trace déjà la courbe (`curve.length >= 1`). Les bornes de période
envoyées à l'API sont des horodatages ISO complets.

---

## Responsive mobile — OBLIGATOIRE sur tous les composants

- `font-size: 16px` minimum sur tous les `input`, `select`, `textarea` — anti-zoom iOS Safari
- `min-width: 0` sur tous les items grid/flex — anti-overflow
- `overflow-x: hidden` sur les containers principaux
- `padding-bottom: calc(env(safe-area-inset-bottom) + Xpx)` sur les footers fixes
- `height: 100dvh` plutôt que `100vh` — évite le bug Safari barre d'adresse
- `viewport-fit=cover` dans `index.html`

```css
/* Règle globale dans chaque composant .css */
@media (max-width: 768px) {
  input, select, textarea { font-size: 16px; }
}
```

---

## Tableau de lignes — pattern partagé (Journal · Mes comptes)

Une liste d'objets comparables (trades, comptes) s'affiche en **lignes alignées**, jamais en
grille de cartes : les cartes ne tiennent pas la montée en charge (6 comptes = un mur) et
laissent un trou quand le compte est impair. Le pattern, identique dans `journal.component.css`
et `accounts.component.css` :

- un **en-tête de colonnes** (`.table-header` / `.acct-thead`) et les lignes partagent LE MÊME
  `grid-template-columns` — deux déclarations à garder synchronisées, sinon l'alignement casse ;
- libellés d'en-tête en mono 9 px, majuscules, `letter-spacing: .1em`, `color: var(--text-3)` ;
- pas d'`overflow: hidden` sur le wrapper si une ligne ouvre un menu « … » : il serait coupé ;
- repli mobile : `.table-header { display: none }`, la ligne repasse en grille de 2-3 colonnes et
  chaque cellule retrouve son étiquette via `content: attr(data-label)` ;
- ce qui ne tient pas à l'écran étroit passe derrière un **dépli** (signal `expandedId`, une
  ligne ouverte à la fois), jamais derrière un scroll horizontal.

⚠️ **Deux pièges de sélecteurs**, tous deux rencontrés en vrai sur « Mes comptes » :
- `:nth-of-type()` compte les **éléments** (tous les `div`), pas les classes : `.cell.num:nth-of-type(2)`
  ne désigne pas la 2ᵉ cellule numérique. Donner une classe explicite à chaque colonne
  (`.cell-balance`, `.cell-pnl`…) ;
- une règle de repli doit **battre en spécificité** la règle desktop : `.cell.num.right` (3 classes)
  gagne contre `.cell.num` même placé plus bas dans le fichier → écrire `.acct-line .cell.num.right`.

Les actions attendues par les tests (synchro, déconnexion) restent **dans le DOM sans interaction** :
les enfermer dans un menu `@if` casse les specs qui les interrogent au rendu.

---

## Features gated — règles obligatoires

⚠️ 2 paliers depuis PROMPT-169 : cf. `.claude/agents/plans.md` (source de vérité).
`isPremium()` = PREMIUM / trial / admin / beta. L'alias `isStarterOrAbove` a été
**supprimé**. L'IA **mutualisée** (contexte marché, news, calendrier éco IA) est **FREE**
(aucun gate front) ; la profondeur d'analyse + l'IA personnelle (analytics avancés, Weekly
Debrief, IA Insights, chat coach, score, recap 17h30) sont **PREMIUM** (`isPremium`).

**Pattern dans les composants qui gate une feature PREMIUM :**

```typescript
private readonly userStore = inject(UserStore);
// on utilise directement userStore.isPremium() dans le template
```

```html
@if (userStore.isPremium()) {
  <!-- feature accessible -->
} @else {
  <mtc-premium-lock title="Titre de la feature" subtitle="Disponible en Premium" />
}
```

Si l'API retourne `{ code: 'PREMIUM_REQUIRED' }` → afficher le lock (ou rediriger vers
`/settings`). Cohérence obligatoire aux 4 points de `plans.md`.

---

## Conventions CSS

```css
/* Variables à utiliser — jamais de valeurs hardcodées */
var(--bg) var(--bg-2) var(--bg-3) var(--bg-card)
var(--border) var(--border-hover)
var(--blue) var(--blue-bright) var(--blue-glow)
var(--green) var(--green-dim)
var(--red) var(--red-dim)
var(--yellow)
var(--text) var(--text-2) var(--text-3)
var(--font-display) var(--font-body) var(--font-mono)
```

---

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

---

## Blocs verrouillés (teaser + overlay)

Deux approches : le composant partagé `mtc-premium-lock` (simple), ou l'overlay
teaser flouté pour les vues riches. **Le cadenas est une icône Lucide `Lock`**
(ou un SVG inline au tracé Lucide) — plus jamais l'emoji 🔒 (incohérent avec les
autres icônes). L'aperçu derrière l'overlay est un **mock** (jamais la vraie donnée
→ pas de fuite).

```html
<div class="locked-feature">
  <div class="locked-preview" aria-hidden="true">
    <!-- aperçu MOCK flou du contenu -->
  </div>
  <div class="locked-overlay">
    <span class="locked-icon">
      <lucide-icon [img]="LockIcon" [size]="20" /> <!-- ou svg inline tracé Lucide -->
    </span>
    <h3>Titre de la feature</h3>
    <p>Description de la valeur ajoutée</p>
    <button (click)="showPlanModal.set(true)">Débloquer →</button>
  </div>
</div>
```

---

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

---

## Source de vérité design

Le miroir statique `app-mytradingcoach.html` a été **retiré** (commit `581875e`) — ne
plus s'y référer ni tenter de le synchroniser. La source de vérité du design c'est :
1. **le composant lui-même** (`*.component.html` / `.ts` inline + `.css`), aligné sur les
   tokens de `styles/theme.css` (« The Terminal » — cf. `.claude/agents/design.md`) ;
2. les **maquettes dédiées** du dépôt (`maquette-*.html`) et le projet Claude Design
   quand ils existent pour la vue concernée.

Règles design non négociables (détail dans `design.md`) : dark only, tokens CSS (jamais
de valeur en dur), chiffres/labels en `--font-mono` + `tabular-nums`, **icônes Lucide**
(jamais d'emoji dans les headers — seuls les émotions trader et watermarks décoratifs
sont tolérés), pas de barre d'accent `::before` sur les cartes de contenu.

---

## data-testid obligatoires

```html
<!-- Auth -->
<input data-testid="login-email" />
<input data-testid="login-password" />
<button data-testid="login-submit" />

<!-- Journal -->
<button data-testid="add-trade-btn" />
<div data-testid="trades-list" />
<div data-testid="win-rate" />
<div data-testid="pnl-total" />
<table data-testid="heatmap" />
<div data-testid="locked-overlay" />

<!-- Dashboard V2 — Session Mode (BETA_TESTER + ADMIN) -->
<button data-testid="tab-dashboard" />
<button data-testid="tab-morning" />
<button data-testid="tab-live" />
<div data-testid="session-morning-view" />
<div data-testid="session-live-view" />
<button data-testid="mood-confident" />
<button data-testid="mood-focused" />
<button data-testid="mood-neutral" />
<button data-testid="mood-tired" />
<button data-testid="start-session" />
<button data-testid="close-session" />
<div data-testid="yesterday-recap" />
<div data-testid="today-objectives" />
<div data-testid="eco-calendar" />
<div data-testid="live-feed" />
<div data-testid="quick-trade-form" />
<input data-testid="quick-trade-asset" />
<button data-testid="quick-trade-long" />
<button data-testid="quick-trade-short" />
<button data-testid="quick-trade-submit" />
<div data-testid="trade-close-panel" />
<input data-testid="trade-exit-price" />
<div data-testid="trade-close-type" />
```

---

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
  `tradovateErrorMessage`, `tradesLine`, `feesLine`, `syncResultLines`, `relativeTime`.
  - `from=wizard` → lu par l'**onboarding** dans `window.location.search`, APRÈS
    `restoreProgress()` : réussite → étape 9 avec le récap (classe `ob-import-recap`, comme le
    CSV) ; échec → étape 8 + message non bloquant (« tu peux réessayer ou importer un CSV ») ;
    plusieurs comptes → sélecteur à l'étape 8. **Jamais l'étape 1**, même si le localStorage a
    disparu.
  - sinon → lu par « Mes comptes » (`router.routerState.snapshot.root.queryParams`).
  - Dans les deux cas, paramètres retirés aussitôt : `router.navigate([], { queryParams:
    {…: null}, queryParamsHandling: 'merge', replaceUrl: true })` — commandes vides = même
    chemin, et un rechargement ne rejoue pas le message.
- **Après une synchro qui crée des trades** : `SelectedAccountStore.load()` +
  `TradesStore.reset()`, sinon dashboard et métriques restent sur l'ancien cache.
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

---

## Feedback utilisateur : toast · inline · bloc persistant (PROMPT-210)

**Un seul système de toasts** : `core/services/toast.service.ts` (`ToastService`, root, signals)
et **un seul conteneur** `mtc-toasts` monté dans `app.ts` (`<router-outlet /><mtc-toasts />`,
hors routeur : il survit aux navigations). Ne JAMAIS recréer un toast local dans un composant
(l'ancien `feedbackToast` de session-live a été retiré).

```typescript
private readonly toast = inject(ToastService);
this.toast.success('Trade supprimé');
this.toast.error(apiErrorMessage(err, "Ce trade n'a pas pu être supprimé."));
this.toast.warning('…', { duration: null }); // null = fermeture manuelle uniquement
```

- Durées : success/info 4 s · warning/error 7 s. Pause au survol ET au focus. Croix sur chaque
  toast. 3 visibles max, les suivants en file (le minuteur ne part qu'à l'affichage). Même
  type + même message déjà affiché → relancé, pas empilé (double-clic).
- A11y : succès/info/warning `role="status"` + `aria-live="polite"` ; erreur `role="alert"` +
  `aria-live="assertive"`. `prefers-reduced-motion` respecté.
- Comportement (usuel, PROMPT-210 bis) : chaque toast vit dans une **case repliable**
  (`.toast-slot`, `grid-template-rows` 0fr ↔ 1fr) : la pile se décale en douceur à l'entrée
  comme à la sortie, sans saut. **Entrée** : glisse depuis le bord droit (0,28 s, léger
  ressort ; depuis le bas en mobile). **Barre de compte à rebours EN HAUT** (`.toast-bar`,
  `scaleX` 1 → 0 sur la durée réelle, figée via `ToastService.isPaused` = même état que le
  minuteur ; recréée quand le même message est relancé grâce à `Toast.version` ; absente si
  `duration: null`). **Sortie** : `[animate.leave]="leaveClass(id)"` (API native Angular
  ≥ 20.2, pas `@angular/animations`) — le toast repart vers le bord puis la case se replie ;
  Angular retire la case à la fin. **Glisser pour fermer** (souris ou doigt,
  `touch-action: pan-y`) : au-delà de max(80 px, 35 % de la largeur) le toast part du côté
  du geste, sinon il revient ; minuteur suspendu pendant le geste. **Mouvement réduit** :
  ni glissement ni repli animé, barre par paliers (`steps`). jsdom ne joue pas les
  animations : `toasts-animation.spec.ts` verrouille les sources (template + CSS lus avec
  `node:fs` en `@vitest-environment node` — un `.css?raw` est VIDE sous vitest).
- Position : bas-droite desktop ; mobile centré en bas **au-dessus du FAB « + »** (92 px) — le
  haut est pris par le burger. z-index 10000 (au-dessus des modales 1000).
- Message d'erreur API : **toujours** `apiErrorMessage(err, repli)` (`core/utils/api-error.ts`) —
  message du back s'il existe (tableaux ValidationPipe joints), sinon repli lisible, jamais
  `undefined`.

**Règle de choix — ne pas tout convertir :**

| Nature | Forme | Exemples |
|---|---|---|
| « Quelque chose vient de se passer, tu peux continuer » | **toast** | Lien copié · Trade enregistré/supprimé/déplacé · échec d'une action ponctuelle · retour OAuth Tradovate · « Import terminé » |
| « Corrige ça ici » | **inline, à côté du champ** | validation de formulaire (trade-form, auth), erreur API rendue dans un formulaire encore ouvert (`[apiError]` de trade-form) |
| « Information à consulter » | **bloc persistant** | récap d'import CSV, frais non rapprochés · P&L brut, position ouverte, avertissements Tradovate de la carte compte |
| État de la page | **pas un toast** | chargement, vide, paywall, « Impossible de charger ton parrainage », carte « Demande envoyée », succès mot de passe oublié / réinitialisé (le bloc REMPLACE le formulaire) |
| Échec partiel actionnable dans une modale ouverte | **inline dans la modale** | suppression d'une journée : trades restants + « Réessayer sur N trades » |

**Plus d'échec muet** : toute mutation déclenchée par l'utilisateur a une branche `error` qui
affiche un toast (ou un message inline si c'est une validation). Les chargements de fond et
rafraîchissements périodiques restent silencieux (état de page). Repérage utilisé en PROMPT-210 :
chercher les `subscribe(` sans `error`, ou dont l'`error` ne fait que relâcher un spinner.

**Tests** : `TestBed.inject(ToastService).visible()` donne `{ type, message }` des toasts
affichés (service réel, pas besoin de le mocker). Pour un composant qui monte `mtc-toasts`
(`app.spec.ts`) : `ɵresolveComponentResources` avec un résolveur vide dans `beforeAll`, puis
`overrideComponent(ToastsComponent, …)` AVANT `compileComponents()`.

## Librairie partagée `@mtc/shared` (2026-09-13)

- Import `from '@mtc/shared'` (stats de trades, valeurs tarifaires) — source unique avec l'API.
  Détails et règles de la lib : `nestjs.md` § « Librairie partagée ».
- Branchement (voir `nestjs.md` § « Librairie partagée » pour la liste complète) : l'alias
  `@mtc/shared` est déclaré **une seule fois**, dans `tsconfig.base.json` (hérité par l'app et
  l'admin, et lu par Nx pour le graphe : une modif de la lib rebuild et redéploie les apps).
  Ne PAS redéclarer `paths` dans le tsconfig d'une app : cela écrase celui de la base.
  Vitest ne lit pas les `paths` : `resolve.alias` dans `apps/app-mytradingcoach/vitest.config.mts`.
  La lib reste dans l'`include` de `tsconfig.spec.json` de l'app (projet `composite`).
- `core/constants/pricing.const.ts` garde ses exports (`PRICING`, `ACCOUNT_LIMITS`,
  `yearlyPerMonth`) mais lit ses VALEURS dans `@mtc/shared` : un prix ne se change plus que dans
  `libs/shared/src/pricing.ts` (+ la landing `Pricing.astro`, non branchée à la lib).

## Couche HTTP, erreurs et templates (étape 4 de l'audit, 2026-09-13)

- **Aucun `HttpClient` dans un composant** : tout appel passe par `core/api/*.api.ts`
  (`AiApi` créé pour cooldown / insights / chat ; `TradesApi.importCsv`, `DebriefApi.exportPdf`,
  `AnalyticsApi.getDailyEquityCurve` ajoutés). Un type de réponse propre à un écran reste dans
  l'écran : la méthode d'API le reçoit en générique (`importCsv<ImportResult>`,
  `insights<InsightsResponse>`). `trades.store` passe aussi par `TradesApi.getAll`, typé sur la
  vraie page de l'API (`TradesPage` : `data` + `nextCursor` + `hasNextPage`, pagination par
  curseur ; l'ancien `PaginatedTrades` à `meta` n'existait pas côté back). Un seul type `Trade`
  (celui de `trades.api.ts`), ré-exporté par le store. Dans un spec, la query d'une requête
  construite avec `HttpParams` se lit dans `request.urlWithParams`, pas `request.url`.
- **Un seul helper d'erreur** : `apiErrorMessage(err, repli)` vit dans `@mtc/shared` (sans
  Angular), ré-exporté par `core/utils/api-error.ts` ; l'admin l'importe directement. Plus de
  `err.error?.message ?? …` en ligne ni de `tradovateErrorText`.
- **Templates de plus de ~150 lignes → `templateUrl` (.html)** : 12 composants migrés
  (session-live, dashboard, csv-import, session-morning, session-day, sidebar, sessions,
  debrief, ai-insights, register ; admin : user-detail, emails). Un spec qui lisait le template
  dans le `.ts` lit maintenant `.ts` + `.html` (cf. `csv-import-*.spec.ts`).
- Mock de `TradesApi` dans un spec qui intercepte le HTTP : lui donner une méthode qui émet la
  vraie requête (`TestBed.inject(HttpClient).delete(...)`), pour garder `HttpTestingController`.

## Découpage dashboard / session-live (audit, 2026-09-13)

- **Dashboard** : le parent garde l'état (période, compte, `httpResource`), le chrome des
  panneaux (`.mtc-panel` + en-tête) et les **états vides** ; chaque viz est un composant de
  `panels/` qui ne reçoit que des données prêtes (`input`). Les calculs vivent dans
  `dashboard-charts.util.ts` (fonctions pures, testées dans `dashboard-charts.util.spec.ts`).
  Les specs du dashboard lisent des membres du parent (`summary`, `baseCapital`,
  `currentCapital`, `accountReallyEmpty`, `dashboardPeriod`, `setPeriod`, `plGranularity`,
  `plTitle`, `periodRange`, `showCsvImport`) : ne pas les déplacer dans un panneau.
- **Session live** : le parent garde le cadre (CTA sans session, carte marché, mini-stats,
  grilles `.live-layout` / `.live-cols`). La **connexion du WebSocket éco** est dans
  `SessionStore` depuis SCA-B4 (voir « Polling »). Calendrier éco, live feed, trade rapide et news
  (ticker + modale) sont dans `session-live/components/`.
- **CSS encapsulée** : le style d'une viz vit dans SON composant (un sélecteur du parent ne
  descend pas dans l'enfant). L'hôte d'un panneau de grille est un flex colonne
  (`:host { display:flex; flex-direction:column; min-width:0; min-height:0 }`) et le bloc
  interne s'étire (`flex:1`) : c'est ce qui reproduit l'étirement de la grille d'avant. Les
  `@container` fonctionnent dans les composants enfants (conteneur résolu dans le DOM).
  Une règle partagée par deux panneaux (`.pulse-dot`, `.col-title`) est dupliquée dans chacun,
  keyframes comprises (Angular préfixe les `@keyframes` d'un composant).
- Vérification d'un tel découpage : empreinte de mise en page (tag, classes, position, taille
  de chaque élément hors hôtes `mtc-*` et icônes) avant / après sur beta avec le compte démo,
  plus un script qui vérifie que chaque classe utilisée par un template a sa règle dans le CSS
  du même composant.

## Migration Angular 22 / Nx 23 / TypeScript 6.0 (étape 5 de l'audit, 2026-09-13)

- Faite par `nx migrate latest` + `--run-migrations` (Angular 22.1.6, CLI/build 22.1.8, Nx 23.2.1,
  TypeScript 6.0.3 — Angular 22 exige TS `>=6.0 <6.1`, donc **pas TypeScript 7**).
- **Migration `safe-optional-chaining` volontairement NON appliquée** : en Angular 22, `a?.b` dans un
  template suit la sémantique JS (`undefined`, plus `null`). La migration aurait entouré les 76 `?.`
  de `$safeNavigationMigration(…)` pour garder `null`. Aucun n'était comparé à `null` et l'affichage
  est identique (`??` traite les deux pareil). Règle désormais : ne pas écrire `=== null` sur le
  résultat d'un `?.` dans un template ; une entrée typée `T | null` qui reçoit un `?.` le verra au
  build (strictTemplates).
- `strict-safe-navigation-narrow` : les diagnostics `nullishCoalescingNotNullable` et
  `optionalChainNotNullable` sont mis en `suppress` dans les `tsconfig.app.json`.
- TypeScript 6 : `ignoreDeprecations: "6.0"` et, dans `tsconfig.base.json`, `types: ["*"]` +
  `noUncheckedSideEffectImports: false` pour garder le comportement de TS 5 (TS 6 change ces défauts).
  Chaque tsconfig a un `rootDir` explicite : `../..` pour l'app, l'admin et leurs specs (ils incluent
  `libs/shared`), sinon `@mtc/shared` sort de la racine et TypeScript refuse le fichier.

## Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026)

- **Source unique des formes JSON échangées** : enums (copie des enums Prisma), trades, sessions,
  débrief, calendrier éco, fiche utilisateur admin, stats VPS. Import : `from '@mtc/shared'`.
- Les dates y sont des `string` ISO (ce que le front reçoit). Côté API, les DTO de requête
  `implements` le contrat (`CreateTradeDto implements CreateTradeRequest`) : un champ ajouté d'un
  seul côté casse la compilation.
- Enums : `EmotionState.FOCUSED` (valeur) / `EmotionState` (type). Le test API
  `common/contracts-sync.spec.ts` compare chaque enum à Prisma : après une migration qui touche un
  enum, mettre à jour `contracts/enums.ts`.
- Jamais de nouvelle interface d'échange recopiée dans `core/api/*.api.ts` : l'ajouter au contrat,
  puis la ré-exporter (`export type { X }`) si des importeurs existants passent par l'API front.
- Aussi partagés : `todayParis` / `parisDayRange` (dates Paris), `normalizeEventKey` / `eventKey`,
  `renderEmailMarkdown` (rendu des campagnes, envoi + aperçu admin).

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
- **Routeur** : `withPreloading(PreloadAllModules)` + `withInMemoryScrolling` (app et admin). Le shell
  connecté défile dans un conteneur (`<main>` / `.content`), pas la fenêtre : `mtcScrollMemory` sur ce
  conteneur remet en haut à chaque page et restaure la position au bouton « Précédent ».
- **Bundle initial < 500 kB (budget bloquant)** : `@lucide/angular` est un seul module ; si un
  composant chargé au démarrage (racine, toasts, dialogues globaux) l'importe, TOUTES les icônes de
  l'app partent dans le bundle initial (+226 kB). Au démarrage : SVG en ligne (cf. `toasts`).
- Dans les libs, sorties en `@Output() … = new EventEmitter()` : leurs tests tournent en JIT, qui
  ne voit pas `output()`.
- **Toute donnée chargée affiche son échec** : `@if (loadError()) { <mtc-error-state (retry)="reload()" /> }`
  avec `loadError = computed(() => !!resource.error())` (Dashboard, Analytics, Scoring en exemple).
- **Paiement** : `inject(BillingService).startCheckout(plan)` (`core/services/billing.service.ts`),
  jamais `BillingApi.checkout` directement.
- **Contrastes** : texte blanc sur un fond plein → `background: var(--primary)` (survol
  `--primary-hover`), jamais `var(--blue)` / `var(--blue-bright)` (trop clairs sous du blanc).
- Les couleurs restent propres à chaque app : l'admin suit sa maquette (teal, Geist), seules la
  structure et l'accessibilité sont partagées.
- Tests : `pnpm nx test front-ui` / `pnpm nx test front-auth` (config Vitest propre à chaque lib :
  l'exécuteur de l'app refuse les specs hors de sa racine). Une lib importée par l'app doit aussi
  être déclarée dans `resolve.alias` de `apps/app-mytradingcoach/vitest.config.mts`.

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
