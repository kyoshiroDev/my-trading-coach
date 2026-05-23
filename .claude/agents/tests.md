# Agent Tests — Vitest + Playwright

## Stack
Vitest (Angular + NestJS) · Playwright (E2E) · Jamais Jest

---

## Commandes

```bash
pnpm nx test app-mytradingcoach        # Vitest Angular
pnpm nx test api-mytradingcoach        # Vitest NestJS
pnpm nx e2e app-mytradingcoach-e2e     # Playwright E2E
pnpm nx test api-mytradingcoach --coverage
```

---

## Config Vitest NestJS

```typescript
// apps/api-mytradingcoach/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

## Config Vitest Angular

```typescript
// apps/app-mytradingcoach/vitest.config.ts
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
});
```

---

## Mock Anthropic — OBLIGATOIRE en CI

Ne jamais appeler la vraie API Anthropic en tests — coût + flakiness.

```typescript
// Dans les specs NestJS
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        patterns: [{
          type: 'alert',
          title: 'Pattern revenge trading',
          description: 'Test description',
          severity: 'alert',
          badge: 'CRITIQUE'
        }]
      })
    }]
  });
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate }
  }));
  return { default: MockAnthropic };
});
```

```typescript
// Dans les specs Playwright — mocker les routes API
await page.route('**/api/ai/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    insights: [{
      type: 'alert',
      title: 'Pattern revenge trading détecté',
      description: 'Après 2 pertes consécutives, win rate chute à 22%.',
      tag: 'CRITIQUE'
    }]
  })
}));

await page.route('**/api/debrief/generate', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    aiSummary: 'Bonne semaine dans l\'ensemble.',
    strengths: [{ badge: 'Force', text: 'Stops respectés à 100%' }],
    weaknesses: [{ badge: 'Critique', text: 'Jeudi après 15h : 4 pertes sur 5' }],
    objectives: [{ title: 'Stopper après 15h le jeudi', reason: 'Pattern détecté' }],
    stats: { winRate: 67, totalPnl: 1840, totalTrades: 28 }
  })
}));
```

---

## Tests critiques NestJS à maintenir

```
├── auth.service.spec.ts
│   → register, login, trial 7j, refresh token
│   → email déjà utilisé → 409
│   → mot de passe incorrect → 401
│
├── trades.service.spec.ts
│   → CRUD complet
│   → limite 50/mois FREE → 403 au 51ème
│   → historique illimité (pas de filtre date)
│
├── analytics.service.spec.ts
│   → summary accessible FREE
│   → by-setup, by-emotion → PREMIUM uniquement
│
├── premium.guard.spec.ts
│   → FREE → 403 avec trialAvailable
│   → PREMIUM → autorisé
│   → trial en cours → autorisé
│   → trial expiré → 403
│
├── beta.guard.spec.ts    ← V2
│   → BETA_TESTER → autorisé
│   → ADMIN → autorisé
│   → USER → 403 code BETA_ONLY
│   → USER + plan PREMIUM → 403 (rôle ≠ plan)
│
├── session.service.spec.ts    ← V2
│   → démarrer session, fermer la session active précédente
│   → getTodayTrades retourne uniquement les trades du jour
│   → closeTrade détecte SL pour un LONG (exitPrice ≤ stopLoss)
│   → closeTrade détecte TP pour un LONG (exitPrice ≥ takeProfit)
│   → closeTrade détecte Manuel si ni SL ni TP touché
│   → getLiveStats calcule winRate correctement
│
├── daily-recap.service.spec.ts    ← V2
│   → génère recap avec stats correctes (pnl, winRate, dominantEmotion)
│   → pas de aiOneLiner pour user FREE
│   → pas de aiOneLiner si < 3 trades
│   → retourne null si aucun trade aujourd'hui
│   → upsert si recap existant pour la même date
│
├── eco-calendar.service.spec.ts    ← V2
│   → retourne les données depuis le cache Redis si disponible
│   → getUserTopAssets retourne les 5 actifs les plus tradés
│   → analyzeReleasedEvent retourne null si event non publié (isReleased: false)
│   → fetchEconomicEvents retourne [] si pas de clé API
│
└── ai.service.spec.ts
    → insights avec mock Anthropic
    → cooldown 4h → 429 au 2ème appel
    → overloaded_error → 503 lisible
    → generateDailyOneLiner retourne string (mock Anthropic)    ← V2
    → analyzeEcoEvents parse le JSON de réponse               ← V2
```

## Tests critiques Angular à maintenir

```
├── user.store.spec.ts    → isPremium(), isFreePlan(), isInTrial()
├── auth.guard.spec.ts    → redirect si non connecté
└── pnl-color.pipe.spec.ts
    → positif → var(--green)
    → négatif → var(--red)
    → null → var(--text-2)
```

---

## Tests E2E Playwright

### Helper partagé

```typescript
// e2e/helpers/auth.ts
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('[data-testid="email"]', email);
  await page.fill('[data-testid="password"]', password);
  await page.click('[data-testid="submit"]');
  await page.waitForURL('/dashboard');
}

export async function createTestTrade(page: Page) {
  await page.click('[data-testid="add-trade"]');
  await page.fill('[data-testid="asset"]', 'BTC/USDT');
  await page.fill('[data-testid="entry"]', '50000');
  await page.click('[data-testid="save-trade"]');
}
```

### Specs E2E

```
e2e/
├── 01-auth.spec.ts              → register → login → dashboard
├── 02-journal.spec.ts           → ajouter trade, voir liste, supprimer
├── 03-analytics-free.spec.ts    → FREE : stats visibles + blocs verrouillés
├── 04-analytics-premium.spec.ts → PREMIUM : tout visible, heatmap présente
├── 05-ai-insights.spec.ts       → FREE : paywall / PREMIUM : insights (mock)
├── 06-weekly-debrief.spec.ts    → FREE : paywall / PREMIUM : rapport (mock)
├── 07-navigation.spec.ts        → sidebar, routes, 404, mobile burger
├── 08-session-mode.spec.ts      ← V2 : vue morning, démarrer session, vue live, quick trade
└── 09-eco-calendar.spec.ts      ← V2 : events, analyse IA, bull/bear, dim hors session
```

### Pattern d'auth E2E pour BETA_TESTER

Mock `/api/auth/me` AVANT `loginUser()` pour retourner `role: 'BETA_TESTER'`.
Le store appelle `fetchMe()` au démarrage → remplace l'utilisateur réel → `isBeta()` true.

```typescript
await page.route('**/api/auth/me', route =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { ...USER, role: 'BETA_TESTER' } }),
  }),
);
await loginUser(page); // login réel, fetchMe mocké
```

### Endpoint test-only NestJS

```typescript
@Post('test/upgrade-user')
async upgradeForTest(@Body() body: { email: string }) {
  if (process.env.NODE_ENV !== 'test') throw new ForbiddenException();
  return this.usersService.upgradeToPremium(body.email);
}
```

---

## Règles générales E2E

1. `data-testid` sur TOUS les éléments interactifs — jamais de sélecteurs CSS
2. Chaque test crée ses propres données dans `beforeEach`
3. Toujours mocker les appels Anthropic en CI
4. `afterEach` nettoie les données pour éviter la pollution
5. Timeout default : 10s, navigation : 15s
