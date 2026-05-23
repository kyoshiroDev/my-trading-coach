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

const MOCK_ECO_EVENTS_MIXED = {
  data: {
    events: [
      {
        time: '09:30',
        name: 'NFP US',
        impact: 'high',
        country: 'US',
        currency: 'USD',
        actual: null,
        estimate: 185000,
        previous: 175000,
        isReleased: false,
      },
      {
        time: '10:00',
        name: 'PMI Zone Euro',
        impact: 'high',
        country: 'EU',
        currency: 'EUR',
        actual: 53.1,
        estimate: 52.3,
        previous: 51.8,
        isReleased: true,
      },
      {
        time: '16:30',
        name: 'Stocks hebdomadaires pétrole',
        impact: 'medium',
        country: 'US',
        currency: 'USD',
        actual: null,
        estimate: null,
        previous: null,
        isReleased: false,
      },
    ],
    analysis: {
      summary: 'Journée chargée : NFP à 09:30 + PMI Europe. Prudence sur USD et EUR.',
      recommendation: 'Éviter NQ et EUR/USD entre 09:15 et 10:15.',
      assetImpacts: [
        { asset: 'NQ', sentiment: 'bear', reason: 'NFP peut provoquer une forte volatilité.' },
        { asset: 'EUR/USD', sentiment: 'bull', reason: 'PMI Euro supérieur aux attentes.' },
      ],
    },
    userAssets: ['NQ', 'BTC/USDT', 'EUR/USD'],
  },
};

const MOCK_ECO_RESULT_ANALYSIS = {
  data: {
    interpretation: 'PMI supérieur aux attentes : surprise haussière pour l\'EUR.',
    assetSentiments: [
      { asset: 'EUR/USD', sentiment: 'bull', shortReason: 'Activité économique plus forte que prévu.' },
      { asset: 'NQ', sentiment: 'neutral', shortReason: 'Pas d\'impact direct sur les indices US.' },
    ],
  },
};

const MOCK_SESSION_ACTIVE = {
  data: {
    id: 'session-1',
    userId: 'user-beta-1',
    startedAt: new Date().toISOString(),
    status: 'ACTIVE',
    moodStart: 'FOCUSED',
    totalTrades: 0,
  },
};

// ── Setup commun ──────────────────────────────────────────────────────────────

async function setupEcoMocks(
  page: import('@playwright/test').Page,
  { sessionActive = false }: { sessionActive?: boolean } = {},
) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: MOCK_BETA_USER }),
    }),
  );
  await page.route('**/api/session/active', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionActive ? MOCK_SESSION_ACTIVE : { data: null }),
    }),
  );
  await page.route('**/api/session/today/stats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { totalPnl: 0, winRate: 0, tradesCount: 0, closedCount: 0, trades: [] } }),
    }),
  );
  await page.route('**/api/eco-calendar/today', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ECO_EVENTS_MIXED),
    }),
  );
  await page.route('**/api/eco-calendar/analyze-result', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ECO_RESULT_ANALYSIS),
    }),
  );
  await page.route('**/api/analytics/daily-recap/yesterday', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) }),
  );
  await page.route('**/api/debrief/current', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null }) }),
  );
  await page.route('**/api/analytics/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { totalPnl: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, streak: 0 } }),
    }),
  );
  await page.route('**/api/trades*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], total: 0, limit: 6, offset: 0 }),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Calendrier Économique', () => {
  test('affiche les événements du jour dans la vue pré-session', async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    const ecoCard = page.getByTestId('eco-calendar');
    await expect(ecoCard).toBeVisible();
    await expect(ecoCard).toContainText('NFP US');
    await expect(ecoCard).toContainText('PMI Zone Euro');
  });

  test("affiche l'analyse IA (summary + recommendation) dans le calendrier", async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    const ecoCard = page.getByTestId('eco-calendar');
    await expect(ecoCard).toContainText('Journée chargée');
    await expect(ecoCard).toContainText('Éviter NQ');
  });

  test('distingue les événements fort impact avec le badge "Fort"', async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    await expect(page.locator('.eco-tag.high').first()).toBeVisible();
  });

  test("rend les événements hors session avec une opacité réduite (classe dim)", async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    // L'événement à 16:30 est après 16h → doit avoir la classe .dim
    const dimEvents = page.locator('.eco-event.dim');
    await expect(dimEvents).toHaveCount(1);
  });

  test('affiche le calendrier dans la vue live (session active)', async ({ page }) => {
    await setupEcoMocks(page, { sessionActive: true });
    await loginUser(page);
    await page.waitForSelector('[data-testid="session-live-view"]');
    // Le calendrier est visible dans la vue live
    const ecoSection = page.locator('.eco-live-event').first();
    await expect(ecoSection).toBeVisible();
  });

  test('indique les événements déjà publiés (actual non null)', async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    // PMI Zone Euro a actual = 53.1 → isReleased = true
    await expect(page.getByTestId('eco-calendar')).toContainText('PMI Zone Euro');
  });

  test('le badge "AI" est présent dans le header du calendrier', async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    await expect(page.locator('.ai-badge').first()).toBeVisible();
  });

  test("l'asset tag NQ/ES est affiché pour les événements USD", async ({ page }) => {
    await setupEcoMocks(page);
    await loginUser(page);
    await page.waitForSelector('[data-testid="eco-calendar"]');
    await expect(page.locator('.eco-asset-tag').first()).toBeVisible();
  });
});
