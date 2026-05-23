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

### Dashboard V2 — logique d'affichage (BETA_TESTER + ADMIN uniquement)

```typescript
// Onglets : 'dashboard' | 'morning' | 'live'
// activeTab = signal<'dashboard' | 'morning' | 'live'>('morning')
// effect() auto-switch vers 'live' si activeSession()?.status === 'ACTIVE'
// Polling interval(30s) pour refreshLiveStats() pendant session active
// isBeta() false → aucun changement, dashboard V1 intact
```

Données chargées au démarrage (beta users) :
- `GET /session/active` → `activeSession` signal
- `GET /analytics/daily-recap/yesterday` → `yesterdayRecap` signal
- `GET /eco-calendar/today` → `ecoCalendar` signal (PREMIUM)
- `GET /debrief/current` → `currentObjectives` signal

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

## Features Premium — règles obligatoires

Import CSV et Export PDF sont réservés aux membres Premium.

**Pattern obligatoire dans les composants qui accèdent à ces features :**

```typescript
private readonly userStore = inject(UserStore);
protected readonly isPremium = this.userStore.isPremium;
```

```html
@if (isPremium()) {
  <!-- feature accessible -->
} @else {
  <div class="paywall">
    <span>⚡</span>
    <p>Fonctionnalité Premium</p>
    <a routerLink="/settings">Essayer 7 jours gratuit →</a>
  </div>
}
```

Si l'API retourne `{ code: 'PREMIUM_REQUIRED' }` → rediriger vers `/settings`.

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

## Blocs Premium verrouillés

```html
<!-- Pattern pour les blocs PREMIUM sur FREE -->
<div class="locked-feature">
  <div class="locked-preview" aria-hidden="true">
    <!-- aperçu flou du contenu -->
  </div>
  <div class="locked-overlay">
    <span class="locked-icon">🔒</span>
    <h3>Titre de la feature</h3>
    <p>Description de la valeur ajoutée</p>
    <button (click)="startTrial()">Essayer 7 jours gratuit →</button>
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

## Synchronisation app-mytradingcoach.html — OBLIGATOIRE

Après chaque modification de composant, mettre à jour la section correspondante dans `app-mytradingcoach.html` à la racine. Ce fichier est la référence design — il doit toujours refléter l'état réel de l'app.

**Procédure :**
1. Lire le composant Angular modifié
2. Trouver la section correspondante dans `app-mytradingcoach.html`
3. Reproduire le HTML/CSS — ne pas inventer
4. Inclure dans le même commit

**Table de correspondance :**
| Composant | Section dans app-mytradingcoach.html |
|---|---|
| dashboard.component | `id="view-dashboard"` |
| journal.component | `id="view-journal"` |
| trade-form.component | modal `id="modal-trade"` |
| analytics.component | `id="view-analytics"` |
| ai-insights.component | `id="view-ai"` |
| debrief.component | `id="view-debrief"` |
| scoring.component | `id="view-scoring"` |
| settings.component | `id="view-settings"` |
| sidebar.component | `aside.sidebar` |
| topbar.component | `header.topbar` |

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
