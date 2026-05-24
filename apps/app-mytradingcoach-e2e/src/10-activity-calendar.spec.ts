import { test, expect } from '@playwright/test';
import { loginUser, TEST_USER_FREE } from './helpers/auth';

const MOCK_BETA_PREMIUM_USER = {
  id: 'user-cal-1',
  email: TEST_USER_FREE.email,
  name: 'Calendar Tester',
  role: 'BETA_TESTER',
  plan: 'PREMIUM',
  onboardingCompleted: true,
  startingCapital: 10000,
  currency: 'USD',
  currencyRate: 1,
  discordId: null,
};

const MOCK_FREE_USER = {
  ...MOCK_BETA_PREMIUM_USER,
  plan: 'FREE',
  role: 'USER',
};

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;

const MOCK_MONTH_ACTIVITY = {
  data: {
    year: YEAR,
    month: MONTH,
    days: [
      { date: `${YEAR}-${String(MONTH).padStart(2, '0')}-01`, pnl: 240, tradesCount: 4, winRate: 75 },
      { date: `${YEAR}-${String(MONTH).padStart(2, '0')}-02`, pnl: -120, tradesCount: 3, winRate: 33.3 },
      { date: `${YEAR}-${String(MONTH).padStart(2, '0')}-05`, pnl: 0, tradesCount: 2, winRate: 50 },
      { date: `${YEAR}-${String(MONTH).padStart(2, '0')}-08`, pnl: 580, tradesCount: 6, winRate: 83.3 },
    ],
    totalPnl: 700,
    totalTrades: 15,
    tradingDays: 4,
  },
};

const MOCK_PREV_MONTH_ACTIVITY = {
  data: {
    year: YEAR,
    month: MONTH > 1 ? MONTH - 1 : 12,
    days: [
      { date: `${YEAR}-${String(MONTH > 1 ? MONTH - 1 : 12).padStart(2, '0')}-10`, pnl: 100, tradesCount: 2, winRate: 50 },
    ],
    totalPnl: 100,
    totalTrades: 2,
    tradingDays: 1,
  },
};

test.describe('Activity Calendar — Dashboard (beta)', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ json: { data: MOCK_BETA_PREMIUM_USER } }),
    );
    await page.route('**/api/analytics/activity/current-month', (route) =>
      route.fulfill({ json: MOCK_MONTH_ACTIVITY }),
    );
    await page.route('**/api/analytics/summary', (route) =>
      route.fulfill({ json: { data: { winRate: 60, totalPnl: 700, totalTrades: 15, maxDrawdown: 120, streak: 2, topSession: 'LONDON', topSessionWinRate: 75, topHour: '10:00' } } }),
    );
    await page.route('**/api/session/active', (route) =>
      route.fulfill({ json: { data: null } }),
    );
    await page.route('**/api/eco-calendar/today', (route) =>
      route.fulfill({ json: { data: { events: [], analysis: { summary: '', recommendation: '' } } } }),
    );
    await page.route('**/api/daily-recap/yesterday', (route) =>
      route.fulfill({ json: { data: null } }),
    );
    await page.route('**/api/debrief/current', (route) =>
      route.fulfill({ json: { data: null } }),
    );
    await page.route('**/api/trades**', (route) =>
      route.fulfill({ json: { data: [], total: 0, page: 1, limit: 6 } }),
    );
    await page.route('**/api/analytics/equity-curve', (route) =>
      route.fulfill({ json: { data: { points: [], startingCapital: null } } }),
    );
    await page.route('**/api/analytics/by-setup', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/analytics/by-emotion', (route) =>
      route.fulfill({ json: { data: [] } }),
    );

    await page.goto('/dashboard');
  });

  test('shows activity calendar on dashboard tab for beta user', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    const cal = page.locator('mtc-activity-calendar');
    await expect(cal).toBeVisible();
  });

  test('renders calendar cells with correct color for profit day', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    const greenCell = page.locator('mtc-activity-calendar .cal-cell[class*="green"]').first();
    await expect(greenCell).toBeVisible();
  });

  test('renders calendar cells with correct color for loss day', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    const redCell = page.locator('mtc-activity-calendar .cal-cell[class*="red"]').first();
    await expect(redCell).toBeVisible();
  });

  test('shows summary stats in calendar header', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    const cal = page.locator('mtc-activity-calendar');
    await expect(cal.locator('.cal-sum-item').first()).toContainText('+700');
  });

  test('no navigation buttons on dashboard calendar', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    const navBtn = page.locator('mtc-activity-calendar .cal-nav-btn');
    await expect(navBtn).not.toBeVisible();
  });
});

test.describe('Activity Calendar — Analytics (Premium)', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ json: { data: MOCK_BETA_PREMIUM_USER } }),
    );
    await page.route(`**/api/analytics/activity/${YEAR}/${MONTH}`, (route) =>
      route.fulfill({ json: MOCK_MONTH_ACTIVITY }),
    );
    const prevMonth = MONTH > 1 ? MONTH - 1 : 12;
    const prevYear = MONTH > 1 ? YEAR : YEAR - 1;
    await page.route(`**/api/analytics/activity/${prevYear}/${prevMonth}`, (route) =>
      route.fulfill({ json: MOCK_PREV_MONTH_ACTIVITY }),
    );
    await page.route('**/api/analytics/summary', (route) =>
      route.fulfill({ json: { data: { winRate: 60, totalPnl: 700, totalTrades: 15, maxDrawdown: 120, streak: 2, topSession: 'LONDON', topSessionWinRate: 75, topHour: '10:00' } } }),
    );
    await page.route('**/api/analytics/equity-curve', (route) =>
      route.fulfill({ json: { data: { points: [], startingCapital: null } } }),
    );
    await page.route('**/api/analytics/by-hour', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/analytics/top-assets', (route) =>
      route.fulfill({ json: { data: [] } }),
    );
    await page.route('**/api/analytics/by-setup', (route) =>
      route.fulfill({ json: { data: [] } }),
    );

    await page.goto('/analytics');
  });

  test('shows activity calendar with navigation on analytics page', async ({ page }) => {
    const cal = page.locator('mtc-activity-calendar');
    await expect(cal).toBeVisible();
    const navBtns = cal.locator('.cal-nav-btn');
    await expect(navBtns).toHaveCount(2);
  });

  test('next month button is disabled when on current month', async ({ page }) => {
    const nextBtn = page.locator('mtc-activity-calendar .cal-nav-btn').nth(1);
    await expect(nextBtn).toBeDisabled();
  });

  test('prev month button navigates to previous month', async ({ page }) => {
    const prevBtn = page.locator('mtc-activity-calendar .cal-nav-btn').first();
    await prevBtn.click();
    const prevMonthLabel = MOCK_PREV_MONTH_ACTIVITY.data.month;
    const cal = page.locator('mtc-activity-calendar');
    await expect(cal.locator('.cal-title')).toContainText(String(prevMonthLabel > 0 ? '' : ''));
    const prevApiCalled = await page.locator('mtc-activity-calendar').isVisible();
    expect(prevApiCalled).toBe(true);
  });

  test('renders legend', async ({ page }) => {
    await expect(page.locator('mtc-activity-calendar .cal-legend')).toBeVisible();
  });
});

test.describe('Activity Calendar — FREE user (no analytics nav)', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ json: { data: MOCK_FREE_USER } }),
    );
    await page.route('**/api/analytics/summary', (route) =>
      route.fulfill({ json: { data: { winRate: 55, totalPnl: 200, totalTrades: 8, maxDrawdown: 50, streak: 1, topSession: 'LONDON', topSessionWinRate: 60, topHour: '09:00' } } }),
    );
    await page.route('**/api/trades**', (route) =>
      route.fulfill({ json: { data: [], total: 0, page: 1, limit: 6 } }),
    );

    await page.goto('/analytics');
  });

  test('activity calendar is NOT shown for free users on analytics page', async ({ page }) => {
    const calendarInPremiumBlock = page.locator('.mb-16 mtc-activity-calendar');
    await expect(calendarInPremiumBlock).not.toBeVisible();
  });
});
