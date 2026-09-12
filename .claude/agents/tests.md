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

## Deux suites côté API : unitaire et intégration

| Suite | Fichiers | Config | Services | Où |
|---|---|---|---|---|
| Unitaire | `src/**/*.spec.ts` | `vitest.config.ts` | aucun (mocks) | `pnpm nx test api-mytradingcoach` |
| Intégration | `src/**/*.int-spec.ts` | `vitest.integration.config.ts` | Postgres + Redis | job CI `integration-referral` |

`*.int-spec.ts` **ne matche pas** `*.spec.ts` : les deux suites ne se mélangent jamais.

### Bootstrap des `*.int-spec.ts` : TOUJOURS `createIntegrationApp()` (PROMPT-209)

Tout `*.int-spec.ts` qui démarre `AppModule` passe par
`src/test/integration-app.helper.ts`, **jamais** par un
`Test.createTestingModule({ imports: [AppModule] })` direct :

```ts
let app: INestApplication;
let baseUrl: string;
let resend: ResendMock; // optionnel : pour vérifier qu'un email a été DÉCLENCHÉ

beforeAll(async () => {
  ({ app, baseUrl, resend } = await createIntegrationApp());
  // besoins spécifiques : createIntegrationApp({ configure: (b) => b.overrideProvider(…)…,
  //                                              setup: (app) => { app.use(…); app.setGlobalPrefix(…) } })
}, 120_000);
// expect(resend.sendWelcomeFree).toHaveBeenCalledWith(expect.objectContaining({ to: email }));
```

Pourquoi : en local la suite lit le `.env` du développeur, qui porte une **vraie clé
Resend** — chaque run envoyait de vrais emails (inscription, reset…) et consommait le
quota. Le helper remplace `ResendService` par un double dérivé de son **prototype** (toute
nouvelle méthode est neutralisée d'office, aucune liste à maintenir). Par défaut il reproduit
l'ancien bootstrap : `rawBody`, préfixe `api`, `init`, `listen(0)`.

Deux filets, verrouillés par `src/test/resend-neutralized.int-spec.ts` :
- **exécution** : `src/test/integration.setup.ts` (setupFiles de la config d'intégration)
  remplace le SDK `resend` par une classe qui **lève à la construction**. Un spec qui
  oublierait le helper échoue avec un message qui le nomme. Volontairement indépendant de
  `NODE_ENV` : en local la suite tourne avec `NODE_ENV=development` (le `.env` racine).
- **statique** : le spec lit tous les `*.int-spec.ts` et échoue s'il trouve un bootstrap
  direct d'`AppModule`, en nommant le fichier.

Même logique pour tout futur service à effet externe réel (autre fournisseur d'email,
SMS…) : le neutraliser dans le helper, pas fichier par fichier.

**Quand l'intégration est nécessaire, et pas seulement confortable** : dès que le
comportement testé dépend de ce que Prisma renvoie *réellement*. Un double Prisma
répond ce qu'on lui dit quel que soit l'`include` — il ne peut donc pas prouver qu'un
`include` est correct. Cas vécu (PROMPT-200) : `effectiveEmotion` était absent de
`create`/`update` faute d'`include tradeSession`, et un test unitaire vérifiant la
valeur de sortie serait passé au vert avec le bug intact en production. Deux parades,
complémentaires : en unitaire, inspecter l'argument passé à Prisma
(`mock.calls[0][0].include`) ; en intégration, laisser le vrai moteur répondre. Vérifier
qu'un test échoue en réinjectant **chaque moitié** du bug séparément (ici : l'`include`
seul, puis le champ calculé seul).

```bash
# intégration, en local (charge le .env de la racine)
cd apps/api-mytradingcoach
env $(grep -vE '^#|^$' ../../.env | xargs -d '\n') \
  pnpm exec vitest run --config vitest.integration.config.ts
```

> ⚠️ **Schéma local souvent périmé.** Le volume `postgres_local_data` survit aux
> `docker compose down` : une base démarrée après une pause a des migrations de retard,
> et les `int-spec` échouent sur une colonne inexistante (`The column X does not exist`)
> qui n'a rien à voir avec le test. Lancer
> `pnpm exec prisma migrate deploy --config=./prisma/prisma.config.ts` avant la suite.

> ⚠️ **Arrêter toute API lancée à côté avant de jouer la suite d'intégration.** Un autre
> process branché sur le même Redis consomme la file BullMQ « stripe » et traite les jobs
> du test avec SON code : les assertions passent au vert sans rien prouver. Constaté en
> vrai — un sabotage de `processReferral` est resté invisible tant qu'une API tournait.
> En CI il n'y a qu'un process, le problème ne se pose pas.

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
├── 09-eco-calendar.spec.ts      ← V2 : events, analyse IA, bull/bear, dim hors session
├── 10-activity-calendar.spec.ts
├── 11-referral-ambassador.spec.ts  ← parrainage : lien, paiement Stripe test, commission 20 %
├── 12-activation.spec.ts           ← funnel n°1 : inscription → wizard → premier trade
└── 13-import-tradovate.spec.ts     ← onboarding puis import CSV (trades + frais)
```

### `12-activation` — le wizard d'onboarding

Helper partagé `src/helpers/onboarding.helper.ts` (utilisé aussi par `13-import`) :

- `goThroughIntro(page, compte?)` — étapes 1-4. Le second paramètre déclare le compte
  de l'étape 4 : sans lui c'est le mode **PERSO**, `{ mode: 'PROPFIRM', broker,
  profitTarget, maxDrawdown, drawdownType }` ouvre le bloc de règles. Les champs prop
  firm n'existent dans le DOM **que** dans ce mode — d'où l'attente sur
  `account-broker` avant de les remplir.
- `crossProfileCheckpoint(page)` — étape 5. **C'est ce clic qui crée le compte de
  trading**, pas l'étape 4 : celle-ci ne fait que déclarer. Se tromper de point
  d'observation fait écrire un test qui ne vérifie rien.
- `accountsOf(email)` — comptes lus **en base**. L'écran « Mes comptes » met en forme et
  masque les règles nulles : il ne distingue pas un `profitTarget` absent d'un
  `profitTarget` à 0, alors que c'est précisément ce que le payload doit garantir.

Points qui ne se devinent pas :

- **L'anti-doublon utile est côté serveur** (`getAll` puis création si zéro compte). Le
  drapeau mémoire du composant ne survit pas à un rechargement : un test qui ne recharge
  pas la page passe même sans la garde. Le test recharge donc **expressément** avant de
  repasser le checkpoint.
- **Compter les POST `/accounts`**, pas les lignes en base : une création refusée par une
  contrainte laisserait la base à 1 compte tout en prouvant que la garde a sauté. Et
  comme la garde est asynchrone, attendre le GET de relecture avant de conclure —
  sinon on constate « pas de POST » simplement parce qu'il n'est pas encore parti.
- Le bouton « Retour » du wizard porte `data-testid="onboarding-back"` sur toutes les
  étapes : une seule est rendue à la fois, le sélecteur reste donc unique.

### `11-referral-ambassador` — paiement réel en mode test

Setup complet dans `apps/app-mytradingcoach-e2e/README.md`. Les points qui ne se
devinent pas, tous vérifiés en exécution :

- **L'événement qui crée la commission est `invoice.payment_succeeded`**, pas
  `checkout.session.completed`. Un test bâti sur le second passerait sans rien vérifier.
- **`handleWebhook` ne fait qu'enqueuer** dans BullMQ et répond `201` ; c'est
  `StripeProcessor` qui écrit la commission. **Redis est donc obligatoire**, et un `2xx`
  sur le webhook ne prouve rien → polling, jamais de `sleep`.
- `stripe trigger` ne convient pas : il crée un customer arbitraire, alors que
  `processReferral` retrouve le filleul par son `stripeCustomerId`.
- Le parrain doit avoir le rôle **AMBASSADOR**, sinon branche « mois offert », 0 commission.
- Client Prisma en e2e : adapter `PrismaPg` sur un pool `pg`, comme `PrismaService`.
  Un `new PrismaClient()` nu échoue en Prisma 7.
- `RegisterDto.referralCode` est plafonné à **20 caractères**.

Deux modes via `E2E_STRIPE_MODE` : `webhook` (défaut, déterministe) et `ui` (vraie page
Stripe hébergée, exige `stripe listen`). Le test skippe avec la raison si l'infra manque,
et refuse de tourner sur une clé qui n'est pas `sk_test_`.

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
