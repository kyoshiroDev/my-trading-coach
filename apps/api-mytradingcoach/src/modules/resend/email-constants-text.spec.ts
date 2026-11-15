import { describe, it, expect } from 'vitest';
import { founderWelcomeTemplate, welcomePremiumTemplate } from './templates';
import { founderLaunchTemplate } from './campaigns/campaign-templates';

/**
 * Audit fonctionnel #993 (lot 2, E4) : les durées et le nombre de places des e-mails viennent des
 * constantes partagées (`@mtc/shared`) ; le texte envoyé aujourd'hui reste identique.
 */
describe('e-mails : valeurs lues dans les constantes, texte inchangé', () => {
  it('bienvenue Premium en essai : 30 jours', () => {
    const { html } = welcomePremiumTemplate({ userName: 'Val', isTrial: true, appUrl: 'https://app' });
    expect(html).toContain('Essai gratuit · 30 jours');
    expect(html).toContain('<strong style="color:#e2eaf5;">30 jours</strong> est activé');
    expect(html).toContain('30 jours offerts, aucun prélèvement.');
  });

  it('bienvenue fondateur : 200 premiers', () => {
    const { html } = founderWelcomeTemplate({
      userName: 'Val', number: 3, priceLabel: '29,00 € par mois', refundUntil: new Date('2026-11-28'), appUrl: 'https://app',
    });
    expect(html).toContain('merci de faire partie des 200 premiers.');
  });

  it('lancement fondateur : remboursé 14 jours (HTML et texte)', () => {
    const c = founderLaunchTemplate({ userName: 'Val', appUrl: 'https://app', unsubUrl: 'https://u', seatsLeft: 200 });
    const all = JSON.stringify(c);
    expect(all).toContain('je te rembourse ton premier paiement sous 14 jours, sans discussion.');
    expect(all).toContain('<b>Satisfait ou remboursé 14 jours</b>');
    expect(all).toContain('- Satisfait ou remboursé 14 jours : tu ne prends aucun risque');
  });
});
