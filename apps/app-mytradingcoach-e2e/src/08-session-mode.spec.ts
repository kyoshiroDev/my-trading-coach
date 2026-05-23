import { test, expect } from '@playwright/test';
import { loginUser, TEST_USER_FREE } from './helpers/auth';

// ── Données mock ──────────────────────────────────────────────────────────────

const MOCK_BETA_USER = {
  id: 'user-beta-1',
  email: TEST_USER_FREE.email,
  name: 'Beta Tester',
  role: 'BETA_TESTER',
  plan: 'PREMIUM',
  onboardingCompleted: true,
  startingCapital: 10000,
  currency: 'USD',
  currencyRate: 1,
  discordId: null,
};

const MOCK_SESSION_ACTIVE = {
  data: {
    id: 'session-1',
    userId: 'user-beta-1',
    startedAt: new Date().toISOString(),
    status: 'ACTIVE',
    moodStart: 'CONFIDENT',
    totalTrades: 0,
  },
};

const MOCK_SESSION_CLOSED = {
  data: { ...MOCK_SESSION_ACTIVE.data, status: 'CLOSED', moodEnd: 'NEUTRAL', endedAt: new Date().toISOString() },
};

const MOCK_LIVE_STATS = {
  data: {
    totalPnl: 880,
    winRate: 75,
    tradesCount: 4,
    closedCount: 3,
    trades: [
      {
        id: 'trade-1',
        asset: 'NQ',
        side: 'LONG',
        entry: 21200,
        exit: 21250,
        stopLoss: 21160,
        takeProfit: 21260,
        pnl: 50,
        emotion: 'CONFIDENT',
        tags: ['TP'],
        tradedAt: new Date().toISOString(),
        sessionId: 'session-1',
      },
    ],
  },
};

const MOCK_YESTERDAY_RECAP = {
  data: {
    id: 'recap-1',
    date: new Date(Date.now() - 86_400_000).toISOString(),
    tradesCount: 12,
    pnl: 620,
    winRate: 72,
    dominantEmotion: 'CONFIDENT',
    aiOneLiner: 'Bonne exécution hier, évite les news aujourd\'hui.',
  },
};

const MOCK_ECO_CALENDAR = {
  data: {
    events: [
      {
        time: '10:00',
        name: 'PMI Zone Euro',
        impact: 'high',
        country: 'EU',
        currency: 'EUR',
        actual: null,
        estimate: 52.3,
        previous: 51.8,
        isReleased: false,
      },
    ],
    analysis: {
      summary: 'Journée chargée côté EUR.',
      recommendation: 'Évite EUR/USD à 10h.',
      assetImpacts: [{ asset: 'NQ', sentiment: 'neutral', reason: 'Pas d\'impact direct.' }],
    },
    userAssets: ['NQ', 'BTC/USDT'],
  },
};

const MOCK_ANALYTICS_SUMMARY = {
  data: { totalPnl: 1240, winRate: 67, totalTrades: 18, maxDrawdown: 320, streak: 2 },
};

// ── Setup commun ──────────────────────────────────────────────────────────────

async function setupBaseMocks(page: import('@playwright/test').Page, sessionActive = false) {
  // Auth : retourner le rôle BETA_TESTER pour que isBeta() soit true
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: MOCK_BETA_USER }),
    }),
  );

  // Session active ou non selon le scénario
  await page.route('**/api/session/active', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionActive ? MOCK_SESSION_ACTIVE : { data: null }),
    }),
  );

  // Stats live (utilisées quand session active)
  await page.route('**/api/session/today/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LIVE_STATS),
    }),
  );

  // Recap hier
  await page.route('**/api/analytics/daily-recap/yesterday', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_YESTERDAY_RECAP),
    }),
  );

  // Calendrier économique
  await page.route('**/api/eco-calendar/today', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ECO_CALENDAR),
    }),
  );

  // Débrief courant (objectifs)
  await page.route('**/api/debrief/current', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    }),
  );

  // Analytics summary (V1 stats)
  await page.route('**/api/analytics/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ANALYTICS_SUMMARY),
    }),
  );

  // Trades store (sidebar + dashboard V1)
  await page.route('**/api/trades*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], total: 0, limit: 6, offset: 0 }),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Mode Session V2', () => {
  test('affiche la vue morning par défaut sans session active', async ({ page }) => {
    await setupBaseMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="session-morning-view"]');
    await expect(page.getByTestId('session-morning-view')).toBeVisible();
    await expect(page.getByTestId('yesterday-recap')).toBeVisible();
    await expect(page.getByTestId('eco-calendar')).toBeVisible();
  });

  test('les trois onglets V2 sont visibles pour un utilisateur BETA', async ({ page }) => {
    await setupBaseMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="tab-dashboard"]');
    await expect(page.getByTestId('tab-dashboard')).toBeVisible();
    await expect(page.getByTestId('tab-morning')).toBeVisible();
    await expect(page.getByTestId('tab-live')).toBeVisible();
  });

  test('peut sélectionner une humeur avant de démarrer', async ({ page }) => {
    await setupBaseMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="mood-focused"]');
    await page.getByTestId('mood-focused').click();
    await expect(page.getByTestId('mood-focused')).toHaveClass(/sel/);
  });

  test('peut démarrer une session et basculer sur la vue live', async ({ page }) => {
    await setupBaseMocks(page);
    await page.route('**/api/session/start', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SESSION_ACTIVE),
      }),
    );
    await loginUser(page);
    await page.waitForSelector('[data-testid="start-session"]');
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('session-live-view')).toBeVisible();
  });

  test('affiche la vue live automatiquement quand une session est déjà active', async ({ page }) => {
    await setupBaseMocks(page, /* sessionActive= */ true);
    await loginUser(page);
    await page.waitForSelector('[data-testid="session-live-view"]');
    await expect(page.getByTestId('session-live-view')).toBeVisible();
    await expect(page.getByTestId('live-feed')).toBeVisible();
    await expect(page.getByTestId('quick-trade-form')).toBeVisible();
  });

  test('le formulaire quick trade contient les champs attendus', async ({ page }) => {
    await setupBaseMocks(page, true);
    await loginUser(page);
    await page.waitForSelector('[data-testid="quick-trade-form"]');
    await expect(page.getByTestId('quick-trade-asset')).toBeVisible();
    await expect(page.getByTestId('quick-trade-long')).toBeVisible();
    await expect(page.getByTestId('quick-trade-short')).toBeVisible();
    await expect(page.getByTestId('quick-trade-submit')).toBeVisible();
  });

  test('peut ouvrir le modal de clôture de session', async ({ page }) => {
    await setupBaseMocks(page, true);
    await page.route('**/api/session/*/close', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SESSION_CLOSED),
      }),
    );
    await loginUser(page);
    await page.waitForSelector('[data-testid="close-session"]');
    await page.getByTestId('close-session').click();
    await expect(page.locator('.close-session-modal')).toBeVisible();
  });

  test('le live feed affiche les trades du jour', async ({ page }) => {
    await setupBaseMocks(page, true);
    await loginUser(page);
    await page.waitForSelector('[data-testid="live-feed"]');
    // Le premier trade mocké (NQ / LONG / TP) doit apparaître
    await expect(page.getByTestId('live-feed')).toContainText('NQ');
  });

  test("l'onglet Dashboard actuel affiche la vue V1", async ({ page }) => {
    await setupBaseMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="tab-dashboard"]');
    await page.getByTestId('tab-dashboard').click();
    // En mode Dashboard, la vue morning n'est plus visible
    await expect(page.getByTestId('session-morning-view')).not.toBeVisible();
  });
});
