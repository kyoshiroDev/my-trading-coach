import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Débriefs passés (#959) : sélecteur de semaine de l'écran Débrief en petite largeur. Parcours démo
 * (`/demo`, base seedée : un débrief par semaine passée tradée, 5 au moins). Assertions de MISE EN
 * PAGE (boîtes mesurées) et changement de semaine réel, pas de capture.
 */

type Doc = { document: { documentElement: { scrollWidth: number } } };
/** Largeur réelle de la page (le projet e2e n'a pas les types DOM : document typé à la main). */
const pageWidth = (page: Page) => page.evaluate(() => (globalThis as unknown as Doc).document.documentElement.scrollWidth);

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('élément non affiché');
  return b;
}

for (const width of [360, 390]) {
  test.describe(`sélecteur de semaine du débrief à ${width} px`, () => {
    test.use({ viewport: { width, height: 740 } });

    test('dans l’écran, 16 px, sans défilement horizontal ; changer de semaine change le débrief', async ({ page }) => {
      await page.goto('/demo');
      await page.waitForURL('**/dashboard');
      await page.goto('/debrief');

      const select = page.getByTestId('debrief-week-select');
      await expect(select).toBeVisible();
      const s = await box(select);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.width, 'sélecteur hors écran').toBeLessThanOrEqual(width);
      // 16 px sous 768 px (styles.css) : pas de zoom iOS au toucher.
      expect(await select.evaluate((el) => getComputedStyle(el as unknown as Element).fontSize)).toBe('16px');
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);

      const title = page.getByTestId('debrief-week-title');
      const before = (await title.textContent())?.trim();
      const values = await select.locator('option').evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value));
      expect(values.length, 'démo : plusieurs semaines attendues').toBeGreaterThan(1);
      const current = await select.inputValue();
      await select.selectOption(values.find((v) => v !== current)!);
      await expect(title).not.toHaveText(before ?? '');
      // Après le changement, toujours rien hors écran.
      expect(await pageWidth(page)).toBeLessThanOrEqual(width);
    });
  });
}
