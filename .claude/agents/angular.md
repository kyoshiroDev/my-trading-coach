# Agent Angular — app-mytradingcoach

## Stack
Angular 21 · Signals · Standalone Components · lucide-angular · Vitest · Nx 22

---

## Règles Angular 21 — ABSOLUES

- `@if` / `@for` / `@switch` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `DestroyRef` à la place de `ngOnDestroy`
- `signal()`, `computed()`, `effect()`, `toSignal()` — signals partout
- `@defer` pour le lazy loading des composants lourds
- Standalone Components exclusivement — pas de NgModules
- Prefix composants : `mtc-`
- Icônes : `lucide-angular` exclusivement (jamais d'autres libs d'icônes)
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
│   ├── dashboard/          dashboard.component.ts + .css
│   │   └── components/
│   │       ├── session-morning/  ← V2 : vue pré-session (mood, recap hier, objectifs, éco calendar)
│   │       │   session-morning.component.ts + .css
│   │       └── session-live/     ← V2 : vue session active (live feed, quick trade, éco live)
│   │           session-live.component.ts + .css
│   ├── journal/            journal.component · trade-form.component · trade-row.component
│   │                       csv-import.component   ← Premium uniquement
│   ├── analytics/          analytics.component · heatmap.component
│   ├── ai-insights/        ai-insights.component · insight-card.component
│   ├── weekly-debrief/     debrief.component · debrief-objectives · debrief-emotions
│   ├── scoring/            scoring.component
│   ├── settings/           settings.component
│   └── auth/               login.component · register.component
├── shared/
│   ├── components/  sidebar/ · topbar/ · stat-card/ · badge/ · locked-feature/
│   └── pipes/       pnl-color.pipe.ts · pnl-format.pipe.ts · emotion-emoji.pipe.ts
│                    session-label.pipe.ts · setup-color.pipe.ts
├── app.component.ts
├── app.config.ts
└── app.routes.ts
```

### « Ma session » — route `/session` (générale, tous plans)

`session-day.component.ts` (features/session-day/) : shell à 3 onglets aligné sur
la maquette design (« The Terminal »).

```typescript
// activeTab = signal<'morning' | 'live' | 'debrief'>('morning')
// effect() auto-switch vers 'live' si activeSession()?.status === 'ACTIVE'
// Polling interval(30s) pour refreshLiveStats() pendant session active
```

- **Shell** : `mtc-topbar` en **mode hero** (`[heroHeader]="true"`) — titre « Ma session »
  + date · compte **empilés sur 2 lignes**, segmented control (icônes Lucide
  Sunrise/Activity/Moon) **centré sur la ligne du header** via le slot `[topbar-center]`,
  action à droite « Démarrer la session » (vert) / pill « Session active + timer » +
  « Clôturer ». La **sidebar se replie en icônes** dès qu'une session est active
  (`SessionStore.hasActiveSession()` → effet dans `sidebar.component`, état manuel
  restauré à la clôture, préférence localStorage non écrasée).
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

---

## Pipes obligatoires — ne jamais dupliquer la logique

```typescript
// Toujours utiliser les pipes, jamais de logique inline
PnlColorPipe      // couleur verte/rouge selon pnl
PnlFormatPipe     // formatage $ avec signe
EmotionEmojiPipe  // emoji selon état émotionnel
SessionLabelPipe  // label lisible de la session
SetupColorPipe    // couleur selon setup
```

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

## Features gated — règles obligatoires

⚠️ Le gating n'est PAS « Premium partout » : cf. `.claude/agents/plans.md` (source de
vérité). `isStarterOrAbove()` = STARTER+ (analytics avancés, weekly debrief, contexte
marché, news, éco IA…) · `isPremium()` = PREMIUM (IA Insights, chat coach, recap 17h30).

**Pattern dans les composants qui gate une feature :**

```typescript
private readonly userStore = inject(UserStore);
protected readonly isStarterOrAbove = this.userStore.isStarterOrAbove; // ou isPremium
```

```html
@if (isStarterOrAbove()) {
  <!-- feature accessible -->
} @else {
  <mtc-premium-lock title="Titre de la feature" subtitle="Disponible dès Starter" />
}
```

Si l'API retourne `{ code: 'PREMIUM_REQUIRED' | 'STARTER_REQUIRED' }` → afficher le lock
(ou rediriger vers `/settings`). Cohérence obligatoire aux 4 points de `plans.md`.

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

// environment.development.ts
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  appName: 'MyTradingCoach [DEV]',
  appUrl: 'http://localhost:4200',
  landingUrl: 'http://localhost:4321',
};
```

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
