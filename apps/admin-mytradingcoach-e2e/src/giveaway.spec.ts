import { test, expect as baseExpect, type Page, type Route } from '@playwright/test';

// Page chargée à la demande (onglet en lazy) : marge pour une machine chargée.
const expect = baseExpect.configure({ timeout: 20_000 });

/**
 * E2E admin « Tirages » (PROMPT-tirage-mensuel, lot A) : allumer avec confirmation, voir
 * l'historique, modérer un message, interrupteur verrouillé en prod avant le lot B.
 * Réseau simulé (`page.route`) : aucune API ni base nécessaires, session admin posée dans le
 * stockage local comme après une connexion. Projet hors CI. En local, contre un build (le serveur de
 * dev compile à la demande et peut ne jamais rendre la page à temps) : `nx run admin-mytradingcoach:build
 * --configuration=development`, servir `dist/apps/admin-mytradingcoach/browser` sur le port 4300 avec
 * repli sur index.html, puis
 * `pnpm exec playwright test -c apps/admin-mytradingcoach-e2e/playwright.config.ts giveaway --project=chromium`.
 */

const WIN = {
  id: 'w1', userId: 'u1', email: 'gagnant@test.local', displayName: 'Léa M.', prizeMonths: 1,
  startsAt: '2027-02-01T08:00:00.000Z', endsAt: '2027-03-01T08:00:00.000Z',
  activationStatus: 'APPLIED', activationError: null, creditCents: null,
  displayConsent: 'PRENOM_INITIALE', message: 'Merci, ça motive !', moderation: 'EN_ATTENTE',
  instagramConsent: false, instagramHandle: null, publicationStatus: 'NONE', publishedUrl: null,
};

function state(over: { freeEnabled?: boolean; activationAvailable?: boolean; moderation?: string } = {}) {
  return {
    free: { pool: 'FREE', enabled: over.freeEnabled ?? false, enabledAt: null, announcedAt: null, eligibleNow: 12, announceAudience: 30 },
    premium: { pool: 'PREMIUM', enabled: false, enabledAt: null, announcedAt: null, eligibleNow: 3, announceAudience: 5 },
    nextDrawAt: '2027-03-01T08:00:00.000Z',
    manualDrawAvailable: false,
    activationAvailable: over.activationAvailable ?? true,
    history: [
      {
        drawId: 'd1', period: '2027-02', pool: 'FREE', drawnAt: '2027-02-01T08:00:00.000Z', eligibleCount: 12,
        eligibleHash: 'h', drawnIndex: 4, win: { ...WIN, moderation: over.moderation ?? 'EN_ATTENTE' },
      },
    ],
  };
}

/** Session admin + API simulée. Renvoie les corps reçus par l'API, pour les assertions. */
async function setup(page: Page, opts: { activationAvailable?: boolean } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let freeEnabled = false;
  let moderation = 'EN_ATTENTE';
  // Données simulées datées de 2027 : horloge du navigateur figée (les délais restent réels).
  await page.clock.setFixedTime(new Date('2027-02-10T10:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('admin_access_token', 'e2e-token');
    localStorage.setItem('admin_user', JSON.stringify({ id: 'admin', email: 'admin@test.local', plan: 'FREE', role: 'ADMIN' }));
  });
  // Polices Google : hors sujet et dépendantes du réseau, elles retardent l'événement « load ».
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData(); // corps non JSON : gardé tel quel, la requête reçoit quand même une réponse
    }
    calls.push({ method: req.method(), url: url.pathname, body });
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (url.pathname.endsWith('/admin/giveaway') && req.method() === 'GET') {
      return json(state({ freeEnabled, moderation, activationAvailable: opts.activationAvailable }));
    }
    if (url.pathname.endsWith('/admin/giveaway/settings')) {
      freeEnabled = (body as { enabled: boolean }).enabled;
      return json({ state: state({ freeEnabled }).free, announcementsQueued: freeEnabled ? 30 : 0 });
    }
    if (url.pathname.endsWith('/admin/giveaway/wins/w1/moderation')) {
      moderation = (body as { moderation: string }).moderation;
      return json({ ...WIN, moderation });
    }
    return json(null); // autres appels de la coquille admin : sans objet ici
  });
  return calls;
}

test.describe('Admin · Tirages', () => {
  // Serveur de dev : la première page compile à la demande.
  test.describe.configure({ timeout: 90_000 });

  test('allumer le tirage gratuit : confirmation avec le nombre d’e-mails, puis appel de l’API', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/tirages', { waitUntil: 'domcontentloaded' });
    const toggle = page.getByTestId('toggle-FREE');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(page.getByTestId('confirm-FREE')).toContainText("30 utilisateurs recevront un e-mail d'annonce");
    expect(calls.some((c) => c.url.endsWith('/settings'))).toBe(false); // rien avant la confirmation
    await page.getByTestId('confirm-yes-FREE').click();
    await expect(page.getByTestId('giveaway-notice')).toContainText("30 e-mails d'annonce");
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(calls.find((c) => c.url.endsWith('/settings'))?.body).toEqual({ pool: 'FREE', enabled: true });
  });

  test('annuler la confirmation : rien n’est envoyé', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/tirages', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('toggle-FREE').click();
    await page.getByTestId('confirm-no-FREE').click();
    await expect(page.getByTestId('confirm-FREE')).toHaveCount(0);
    expect(calls.some((c) => c.url.endsWith('/settings'))).toBe(false);
  });

  test('historique et modération : « Valider » puis « Refuser »', async ({ page }) => {
    const calls = await setup(page);
    await page.goto('/tirages', { waitUntil: 'domcontentloaded' });
    const history = page.getByTestId('giveaway-history');
    await expect(history).toContainText('gagnant@test.local');
    await expect(history).toContainText('Léa M.');
    await expect(history).toContainText('Merci, ça motive !');
    await page.getByTestId('validate-w1').click();
    await expect(history).toContainText('Validé');
    await page.getByTestId('refuse-w1').click();
    await expect(history).toContainText('Refusé');
    const bodies = calls.filter((c) => c.url.endsWith('/moderation')).map((c) => c.body);
    expect(bodies).toEqual([{ moderation: 'VALIDE' }, { moderation: 'REFUSE' }]);
  });

  test('prod avant le lot B : interrupteur verrouillé et expliqué', async ({ page }) => {
    await setup(page, { activationAvailable: false });
    await page.goto('/tirages', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('toggle-FREE')).toBeDisabled();
    await expect(page.getByTestId('activation-locked-FREE')).toContainText('lot B');
    await expect(page.getByTestId('toggle-FREE')).toHaveAttribute('aria-describedby', 'activation-locked-FREE');
  });
});
