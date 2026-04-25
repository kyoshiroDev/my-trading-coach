import { Page } from '@playwright/test';

export const TEST_USER_FREE = {
  email: 'free-e2e@test.com',
  password: 'TestPassword123!',
};

export const TEST_USER_PREMIUM = {
  email: 'premium-e2e@test.com',
  password: 'TestPassword123!',
};

export async function loginUser(page: Page, user = TEST_USER_FREE): Promise<void> {
  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', user.email);
  await page.fill('[data-testid="login-password"]', user.password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('/dashboard', { timeout: 15000 });
}

export async function logoutUser(page: Page): Promise<void> {
  await page.click('[data-testid="logout-btn"]');
  await page.waitForURL('/login');
}

export async function createTestTrade(page: Page, overrides: Record<string, string> = {}): Promise<void> {
  const trade = {
    asset: 'BTC/USDT', side: 'LONG', entry: '50000',
    emotion: 'CONFIDENT',
    ...overrides,
  };
  await page.click('[data-testid="add-trade-btn"]');
  await page.fill('[data-testid="trade-asset"]', trade.asset);
  await page.click(`[data-testid="trade-side-${trade.side.toLowerCase()}"]`);
  await page.fill('[data-testid="trade-entry"]', trade.entry);
  await page.click(`[data-testid="emotion-${trade.emotion.toLowerCase()}"]`);
  await page.click('[data-testid="trade-submit"]');
}

export async function mockAnthropicInsights(page: Page): Promise<void> {
  await page.route('**/api/ai/insights', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        insights: [{
          type: 'weakness',
          title: 'Revenge trading détecté',
          description: 'Après 2 pertes consécutives, win rate chute à 22%.',
          badge: 'Attention',
        }],
        topPattern: 'Revenge trading fréquent après pertes.',
        emotionInsight: 'Les trades STRESSED ont un win rate de 18%.',
      },
    }),
  }));
}

export async function mockAnthropicDebrief(page: Page): Promise<void> {
  await page.route('**/api/debrief/generate', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        id: 'test-debrief-id',
        weekNumber: 17,
        year: 2026,
        startDate: '2026-04-20T00:00:00.000Z',
        endDate: '2026-04-26T00:00:00.000Z',
        aiSummary: "Bonne semaine dans l'ensemble.",
        insights: {
          summary: "Bonne semaine.",
          strengths: [{ badge: 'Force', text: 'Stops respectés à 100%' }],
          weaknesses: [{ badge: 'Critique', text: 'Jeudi après 15h : 4 pertes sur 5' }],
          emotionInsight: 'Corrélation forte entre STRESSED et pertes.',
          objectives: [{ title: 'Stopper après 15h le jeudi', reason: 'Pattern détecté' }],
        },
        strengths: [{ badge: 'Force', text: 'Stops respectés à 100%' }],
        weaknesses: [{ badge: 'Critique', text: 'Jeudi après 15h : 4 pertes sur 5' }],
        objectives: [{ title: 'Stopper après 15h le jeudi', reason: 'Pattern détecté' }],
        stats: { winRate: 67, totalPnl: 1840, totalTrades: 28 },
        generatedAt: new Date().toISOString(),
      },
    }),
  }));
}
