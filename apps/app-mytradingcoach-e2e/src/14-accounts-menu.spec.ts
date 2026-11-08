/// <reference lib="dom" />  // evaluate() : code exécuté dans la page
import { test, expect, type Page } from '@playwright/test';

/**
 * Mes comptes · menu « … » (Modifier / Supprimer) sur une ligne ARCHIVÉE.
 *
 * Bug corrigé : dans la ligne, le menu héritait de l'opacité du compte archivé et restait sous la
 * ligne suivante (contexte d'empilement) ; le clic sur « Supprimer » sélectionnait la ligne du
 * dessous. Le menu est désormais rendu hors du tableau, en position fixe.
 *
 * Vrai clic Chromium : Playwright refuse de cliquer si un autre élément intercepterait le pointeur,
 * c'est exactement ce que ce test vérifie. AUCUNE API requise : session posée dans le localStorage,
 * toutes les routes `/api` simulées. Lancer seul :
 *   pnpm exec playwright test src/14-accounts-menu.spec.ts  (depuis apps/app-mytradingcoach-e2e)
 */

const NOW = new Date().toISOString();

const USER = {
  id: 'user-menu-e2e',
  email: 'menu-e2e@test.local',
  name: 'Menu E2E',
  role: 'USER',
  plan: 'PREMIUM',
  onboardingCompleted: true,
  startingCapital: 50000,
  currency: 'USD',
  currencyRate: 1,
  discordId: null,
  isDemo: false,
  emailVerified: true,
  createdAt: NOW,
};

function account(id: string, label: string, status: 'ACTIVE' | 'ARCHIVED', tradesCount: number) {
  return {
    id, label, broker: 'Lucid', type: 'EVALUATION', status,
    accountSize: 50000, currency: 'USD', startingBalance: 50000, profitTarget: 3000, maxDrawdown: 2000,
    drawdownType: 'TRAILING', propFirmPlanId: null, platform: null, lastPayoutAt: null,
    planLinkChoice: 'LATER', unlistedFirm: null, createdAt: NOW, updatedAt: NOW,
    floorReached: false, openIncidentId: null, overFreeLimit: false,
    metrics: {
      startingBalance: 50000, realizedPnl: 0, currentBalance: 50000, tradesCount, winRate: null,
      bestDay: null, worstDay: null, objective: { current: 0, target: 3000, pct: 0 },
      drawdown: { type: 'TRAILING', floor: 48000, margin: 2000, maxDrawdown: 2000, pct: 1, breached: false, source: 'manual', rule: null },
      drawdownUnconfirmed: false, progress: null, dailyLoss: null, broker: null,
      estimated: true, disclaimer: 'Estimation.',
    },
  };
}

const ACCOUNTS = [
  account('act-1', 'Actif 1', 'ACTIVE', 3),
  account('act-2', 'Actif 2', 'ACTIVE', 0),
  account('arc-1', 'Archivé haut', 'ARCHIVED', 12),
  account('arc-2', 'Archivé milieu', 'ARCHIVED', 7),
  account('arc-3', 'Archivé bas', 'ARCHIVED', 4),
];

/** Suppressions définitives reçues par l'API simulée. */
let deletes: { id: string; body: unknown }[] = [];

async function mockApi(page: Page): Promise<void> {
  deletes = [];
  await page.addInitScript((user) => {
    localStorage.setItem('access_token', 'e2e-fake-token');
    localStorage.setItem('user', JSON.stringify(user));
  }, USER);
  // Toutes les requêtes API : une liste vide par défaut, les routes utiles simulées.
  await page.route(/\/api\//, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api/, '');
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (path === '/auth/me' || path === '/users/me') return json(USER);
    if (path === '/accounts' && route.request().method() === 'GET') return json(ACCOUNTS);
    if (/^\/accounts\/[^/]+\/deletion-preview$/.test(path)) {
      const id = path.split('/')[2];
      const a = ACCOUNTS.find((x) => x.id === id);
      return json({ archived: true, tradesCount: a?.metrics.tradesCount ?? 0, sessionsCount: 0, brokerConnected: id === 'arc-2' });
    }
    if (/^\/accounts\/[^/]+\/archived$/.test(path) && route.request().method() === 'DELETE') {
      const id = path.split('/')[2];
      deletes.push({ id, body: route.request().postDataJSON() });
      return json({ deleted: true, tradesDeleted: ACCOUNTS.find((x) => x.id === id)?.metrics.tradesCount ?? 0 });
    }
    return json([]);
  });
}

async function openArchived(page: Page): Promise<void> {
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-table')).toBeVisible();
  const archived = page.getByTestId('archived-accounts');
  await archived.locator('summary').click();
  await expect(page.getByTestId('account-menu-arc-3')).toBeVisible();
}

/** Ouvre le menu de la ligne, clique RÉELLEMENT « Supprimer » et vérifie la bonne confirmation. */
async function deleteFromMenu(page: Page, id: string, label: string): Promise<void> {
  await page.getByTestId(`account-menu-${id}`).scrollIntoViewIfNeeded();
  await page.getByTestId(`account-menu-${id}`).click();
  const pop = page.getByTestId('account-menu-pop');
  await expect(pop).toBeVisible();
  // Le menu n'est plus translucide : opacité effective 1 (aucun ancêtre atténué).
  const opacity = await pop.evaluate((el) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  });
  expect(opacity).toBe(1);
  // Au centre ET au bas de « Supprimer » (la partie qui déborde sur la ligne suivante), l'élément
  // touché est bien l'entrée du menu, pas la ligne du dessous.
  const del = page.getByTestId(`account-delete-${id}`);
  const box = await del.boundingBox();
  expect(box).not.toBeNull();
  for (const y of [box!.height / 2, box!.height - 3]) {
    const hit = await page.evaluate(([x, yy]) => {
      const el = document.elementFromPoint(x, yy);
      return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
    }, [box!.x + box!.width / 2, box!.y + y] as const);
    expect(hit, `point à ${Math.round(y)} px du haut de « Supprimer »`).toBe(`account-delete-${id}`);
  }

  // Vrai clic, sur le bas de l'entrée.
  await del.click({ position: { x: box!.width / 2, y: box!.height - 3 } });
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(label);
  // Rien n'est supprimé sans confirmation : on annule.
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toBeHidden();
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile 360', width: 360, height: 740 },
]) {
  test.describe(`Mes comptes · menu d'un compte archivé (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.beforeEach(async ({ page }) => {
      await mockApi(page);
      await openArchived(page);
    });

    test('ligne du milieu : « Supprimer » reçoit le clic', async ({ page }) => {
      await deleteFromMenu(page, 'arc-2', 'Archivé milieu');
    });

    test('dernière ligne : « Supprimer » reçoit le clic', async ({ page }) => {
      await deleteFromMenu(page, 'arc-3', 'Archivé bas');
    });

    test('clic hors du menu et Échap : le menu se ferme', async ({ page }) => {
      await page.getByTestId('account-menu-arc-2').click();
      await expect(page.getByTestId('account-menu-pop')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('account-menu-pop')).toBeHidden();
      await page.getByTestId('account-menu-arc-2').click();
      await page.getByTestId('accounts-table').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('account-menu-pop')).toBeHidden();
    });

    test('suppression confirmée : modale explicite puis DELETE /archived avec confirmation', async ({ page }) => {
      await page.getByTestId('account-menu-arc-2').click();
      await page.getByTestId('account-delete-arc-2').click();
      const dialog = page.getByTestId('confirm-dialog');
      await expect(dialog).toContainText('Archivé milieu');
      await expect(dialog).toContainText('7 trades seront supprimés');
      await expect(dialog).toContainText('connexion Tradovate sera aussi supprimée');
      await expect(dialog).toContainText('Action définitive');
      expect(deletes).toEqual([]); // rien au premier clic
      await page.getByTestId('confirm-ok').click();
      await expect.poll(() => deletes).toEqual([{ id: 'arc-2', body: { confirm: true } }]);
    });
  });
}
