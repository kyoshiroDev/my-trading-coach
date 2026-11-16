# Tests E2E Playwright

> Contenu déplacé à l'identique depuis `.claude/agents/tests.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : tests.md · Tests E2E Playwright · 2026-04-25 -->
> **Origine** : `tests.md` · « Tests E2E Playwright » · 2026-04-25

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

### Specs E2E (`apps/app-mytradingcoach-e2e/src/`)

```
├── smoke.spec.ts                   ← parcours démo, lancé en CI (non bloquant)
├── critical-paths.spec.ts          → auth, routes protégées, journal, paywalls FREE/PREMIUM
├── 08-session-mode.spec.ts         → vue morning, démarrer session, vue live, quick trade
├── 09-eco-calendar.spec.ts         → events, analyse IA factuelle (écart calculé, pas de bull/bear, #920), dim hors session
├── 10-activity-calendar.spec.ts
├── 11-referral-ambassador.spec.ts  → parrainage : lien, paiement Stripe test, commission 20 %
├── 12-activation.spec.ts           → funnel n°1 : inscription → wizard → premier trade
└── 13-import-tradovate.spec.ts     → onboarding puis import CSV (trades + frais)
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

**Retour de Stripe sur un banc local : même hôte que l'app.** Les URL de retour du Checkout
(`return_url`, `success_url`, portail) partent de `FRONTEND_URL`, qui vaut `http://localhost:4200`
par défaut. Une app servie sur `127.0.0.1:4200` est une AUTRE origine : au retour de Stripe, le
navigateur arrive sur `localhost` sans la session (stockage propre à l'origine) et le navigateur
peut proposer l'autoremplissage du formulaire de connexion. Vu au test Klarna du 28/10 (#769) :
servir l'app et régler `FRONTEND_URL` sur le même hôte, ou vérifier la fin du parcours par les
journaux et la base. Sans effet en dev, beta et prod (`FRONTEND_URL` = l'URL publique de l'app).

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
