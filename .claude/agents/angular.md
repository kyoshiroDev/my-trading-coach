# Agent Angular — app-mytradingcoach

## Stack
Angular 20 · Zoneless · Signals · Standalone Components · lucide-angular · Vitest

---

## Règles Angular 20 — ABSOLUES

- `provideZonelessChangeDetection()` + `provideBrowserGlobalErrorListeners()` dans `app.config.ts`
- `@if` / `@for` / `@switch` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `DestroyRef` à la place de `ngOnDestroy`
- `signal()`, `computed()`, `effect()`, `toSignal()` — signals partout
- `resource()` / `httpResource()` pour les appels HTTP liés à des signals
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
│   └── stores/     trades.store.ts · user.store.ts
├── features/
│   ├── dashboard/          dashboard.component.ts + .html + .css
│   ├── journal/            journal.component · trade-form.component · trade-row.component
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
<!-- Sur tous les éléments interactifs clés -->
<input data-testid="email" />
<input data-testid="password" />
<button data-testid="submit" />
<button data-testid="add-trade" />
<div data-testid="trades-list" />
<div data-testid="win-rate" />
<div data-testid="pnl-total" />
<table data-testid="heatmap" />
<div data-testid="locked-overlay" />
```
