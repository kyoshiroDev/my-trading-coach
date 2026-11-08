import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Sélecteur de compte en petite largeur (#879) : le nom de la firme ne passe jamais sous le solde,
 * le solde n'est jamais coupé, rien ne déborde de l'écran. Assertions de MISE EN PAGE (boîtes
 * mesurées), pas de capture.
 *
 * Parcours démo (`/demo`, base seedée comme le smoke) ; la liste des comptes renvoyée par l'API est
 * réécrite pour chaque cas (firmes longues, gros solde, solde négatif, badge, un seul compte).
 */

type Acct = Record<string, unknown> & { id: string; label: string; metrics: Record<string, unknown> };

interface Scenario {
  name: string;
  /** Réécrit la liste des comptes de la démo (au moins un compte). */
  rewrite: (accounts: Acct[]) => Acct[];
  /** Compte à sélectionner : index dans la liste réécrite, ou « all » (Tous les comptes). */
  pick: number | 'all';
}

const withMetrics = (a: Acct, balance: number): Acct => ({ ...a, metrics: { ...a.metrics, currentBalance: balance } });

const SCENARIOS: Scenario[] = [
  {
    name: 'firme longue, nom long, 150 000 $',
    rewrite: (l) => [withMetrics({ ...l[0], label: 'Take Profit 150k · Éval #12 (compte principal)', broker: 'Take Profit Trader', type: 'EVALUATION' }, 150_000), ...l.slice(1)],
    pick: 0,
  },
  {
    name: 'solde négatif',
    rewrite: (l) => [withMetrics({ ...l[0], label: 'Lucid 50k · Funded', broker: 'Lucid Trading', type: 'FUNDED' }, -1_234.56), ...l.slice(1)],
    pick: 0,
  },
  {
    name: 'badge Échoué',
    rewrite: (l) => [withMetrics({ ...l[0], label: 'Topstep 100k · Éval', broker: 'Topstep', type: 'EVALUATION', status: 'FAILED' }, 98_765.43), ...l.slice(1)],
    pick: 0,
  },
  {
    name: 'un seul compte (Apex)',
    rewrite: (l) => [withMetrics({ ...l[0], label: 'Apex 50k · Éval #2', broker: 'Apex Trader Funding', type: 'EVALUATION' }, 51_078)],
    pick: 0,
  },
  {
    name: 'Tous les comptes / Agrégé',
    rewrite: (l) => l.map((a, i) => withMetrics(a, i === 0 ? 150_000 : -2_500)),
    pick: 'all',
  },
];

const WIDTHS = [320, 360, 390, 768];

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('élément non affiché');
  return b;
}

type Box = { x: number; y: number; width: number; height: number };

/** Deux boîtes se recouvrent (tolérance d'un demi-pixel d'arrondi). */
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** Ouvre le menu (le clic peut tomber pendant le rechargement de la liste des comptes). */
async function openMenu(page: Page, trigger: Locator) {
  const menu = page.locator('.acct-menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await trigger.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Le texte d'un élément tient dans sa boîte (pas coupé, pas d'ellipsis). */
type Sized = { scrollWidth: number; clientWidth: number };
const fits = (l: Locator) =>
  l.evaluate((el) => (el as unknown as Sized).scrollWidth <= (el as unknown as Sized).clientWidth + 1);

async function openDemoWith(page: Page, s: Scenario) {
  await page.route(/\/api\/accounts(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { data: Acct[] };
    await route.fulfill({ response: res, json: { ...body, data: s.rewrite(body.data) } });
  });
  await page.goto('/demo');
  await page.waitForURL('**/dashboard');
  await page.goto('/analytics');
  const trigger = page.getByTestId('acct-trigger');
  await expect(trigger).toBeVisible();
  await openMenu(page, trigger);
  if (s.pick === 'all') {
    await page.getByTestId('account-option-all').click();
  } else {
    await page.locator('[data-testid^="account-option-"]:not([data-testid="account-option-all"])').nth(s.pick).click();
  }
  return trigger;
}

for (const width of WIDTHS) {
  test.describe(`sélecteur de compte à ${width} px`, () => {
    test.use({ viewport: { width, height: 740 } });

    for (const s of SCENARIOS) {
      test(`${s.name}`, async ({ page }) => {
        const trigger = await openDemoWith(page, s);
        const tag = trigger.locator('.acct-tag');
        const bal = trigger.locator('.acct-bal');
        const name = trigger.locator('.acct-name');

        await expect(page.locator('.acct-menu')).toBeHidden();
        const [t, b, n, tr] = [await box(tag), await box(bal), await box(name), await box(trigger)];
        // Nom et type · firme alignés à gauche, l'un sous l'autre (jamais centrés).
        expect(Math.abs(n.x - t.x), 'nom et type · firme non alignés').toBeLessThanOrEqual(1);
        // Ni le nom ni la ligne type · firme ne passent sous le solde (sur une ou deux lignes).
        expect(overlap(t, b), 'type · firme sous le solde').toBe(false);
        expect(overlap(n, b), 'nom sous le solde').toBe(false);
        // Le texte tronqué reste dans le bouton.
        expect(t.x + t.width).toBeLessThanOrEqual(tr.x + tr.width);
        expect(n.x + n.width).toBeLessThanOrEqual(tr.x + tr.width);
        // Solde entier, dans le bouton.
        expect(await fits(bal), 'solde coupé').toBe(true);
        expect(b.x).toBeGreaterThanOrEqual(tr.x);
        expect(b.x + b.width).toBeLessThanOrEqual(tr.x + tr.width);
        // Rien ne déborde de l'écran (pas de défilement horizontal de la page).
        expect(tr.x + tr.width).toBeLessThanOrEqual(width);
        // Largeur réelle de la page (le projet e2e n'a pas les types DOM : élément typé à la main).
        expect(await page.locator('html').evaluate((el) => (el as unknown as Sized).scrollWidth)).toBeLessThanOrEqual(width);

        // Menu ouvert : chaque option garde son solde entier, sans texte dessous.
        await openMenu(page, trigger);
        const options = page.locator('.acct-menu .opt');
        const count = await options.count();
        for (let i = 0; i < count; i++) {
          const opt = options.nth(i);
          await opt.scrollIntoViewIfNeeded(); // menu à hauteur bornée, qui défile
          const obal = await box(opt.locator('.opt-bal'));
          for (const part of ['.opt-name', '.opt-tag']) {
            expect(overlap(await box(opt.locator(part)), obal), `option ${i} : ${part} sous le solde`).toBe(false);
          }
          expect(await fits(opt.locator('.opt-bal')), `option ${i} : solde coupé`).toBe(true);
        }
        const menu = await box(page.locator('.acct-menu'));
        expect(menu.x + menu.width, 'menu hors écran').toBeLessThanOrEqual(width);
      });
    }
  });
}

test.describe('ordinateur (1280 px) : mise en page inchangée', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('bouton de 260 px au moins, solde à droite du texte', async ({ page }) => {
    const trigger = await openDemoWith(page, SCENARIOS[3]);
    const tr = await box(trigger);
    expect(tr.width).toBeGreaterThanOrEqual(260);
    const [t, b] = [await box(trigger.locator('.acct-txt')), await box(trigger.locator('.acct-bal'))];
    expect(t.x + t.width).toBeLessThanOrEqual(b.x + 0.5);
  });
});
