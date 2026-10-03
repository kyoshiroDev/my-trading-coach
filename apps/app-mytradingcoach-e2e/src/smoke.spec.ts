import { test, expect, Page } from '@playwright/test';

/**
 * Smoke du parcours démo : /demo → dashboard → journal → analytics.
 * Nécessite l'app, l'API et une base où le compte démo a été seedé (`pnpm seed:demo`).
 * Lancé en CI par le job `smoke-e2e` (non bloquant tant qu'il n'a pas fait ses preuves).
 * Échoue sur toute réponse API 5xx ou erreur console : un écran « vide mais sans erreur »
 * n'est pas un succès.
 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Les échecs réseau sont suivis plus bas (API seulement) : une police ou un script
    // tiers indisponible ne doit pas faire échouer le smoke de l'app.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`page: ${err.message}`));
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) {
      errors.push(`api ${res.status()}: ${res.url()}`);
    }
  });
  // Le smoke teste l'API démarrée par le job : un appel à une API déployée (dev, beta, prod)
  // veut dire que l'app a été compilée avec le mauvais environnement.
  page.on('request', (req) => {
    if (/^https:\/\/[^/]*api\.mytradingcoach\.app\//.test(req.url())) {
      errors.push(`api distante appelée (attendu : localhost:3001) : ${req.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    // ERR_ABORTED = requête annulée par la navigation suivante, pas une panne.
    const reason = req.failure()?.errorText ?? '';
    if (req.url().includes('/api/') && !reason.includes('ERR_ABORTED')) {
      errors.push(`api failed (${reason}): ${req.url()}`);
    }
  });
  return errors;
}

test('smoke démo — dashboard, journal, analytics', async ({ page }) => {
  const errors = watchErrors(page);

  await page.goto('/demo');
  await page.waitForURL('**/dashboard');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/journal');
  await expect(page.locator('main')).toContainText(/trade/i);

  const analytics = page.waitForResponse((res) => res.url().includes('/api/analytics'));
  await page.goto('/analytics');
  expect((await analytics).ok()).toBe(true);
  await expect(page.locator('main')).toBeVisible();

  expect(errors).toEqual([]);
});
