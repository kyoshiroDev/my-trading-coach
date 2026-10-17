import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Garde : chaque affichage du compteur passe par founderSeatsLabel, aucun libellé maison ne revient
// (« Plus que 200 places sur 200 » affiché le 17/10 alors qu'aucune place n'était prise).
describe('founderSeatsLabel est utilisé par tous les affichages du compteur', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
  const sources = {
    'modale de plans (app)': 'apps/app-mytradingcoach/src/app/shared/components/plan-modal/plan-modal.component.ts',
    'page de paiement (app)': 'apps/app-mytradingcoach/src/app/features/checkout/checkout-copy.ts',
    'carte Fondateur (landing)': 'apps/landing-mytradingcoach/src/components/Pricing.astro',
    'bandeau (landing)': 'apps/landing-mytradingcoach/src/components/FounderBanner.astro',
    'e-mail de lancement': 'apps/api-mytradingcoach/src/modules/resend/campaigns/campaign-templates.ts',
  };

  for (const [where, file] of Object.entries(sources)) {
    it(`${where} : founderSeatsLabel, pas de « Plus que » écrit à la main`, () => {
      const src = read(file);
      expect(src).toContain('founderSeatsLabel');
      expect(src).not.toMatch(/Plus que \$\{|Plus qu'une place|places? restantes?\$|restante\$\{/);
    });
  }

  it('le gabarit de la modale n’écrit plus le compteur lui-même', () => {
    const html = read('apps/app-mytradingcoach/src/app/shared/components/plan-modal/plan-modal.component.html');
    expect(html).not.toMatch(/Plus que|seatsLeft/);
  });
});
