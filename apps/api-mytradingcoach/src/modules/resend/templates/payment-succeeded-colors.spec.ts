import { describe, it, expect } from 'vitest';
import { ACCENT, paymentSucceededTemplate } from './index';

/**
 * #1159 (décision de Greg du 2026-11-21) : le vert est réservé aux gains (règle design 3). L'e-mail
 * « paiement reçu » prend la couleur de marque, plus aucun vert.
 */
describe('E-mail paiement reçu — couleurs', () => {
  const { html, subject } = paymentSucceededTemplate({ userName: 'Lucas', amount: '49,00 €', appUrl: 'https://app' });

  it('barre d’accent et bordure de carte aux couleurs de la marque', () => {
    expect(html).toContain(ACCENT.brand);
    expect(html).toContain('rgba(59,130,246,.3)');
  });

  it('aucun vert (#10b981, rgba(16,185,129,…), dégradé « success »)', () => {
    expect(html).not.toContain('#10b981');
    expect(html).not.toContain('16,185,129');
    expect(html).not.toContain(ACCENT.success);
  });

  it('objet sans emoji coche (vert dans la boîte de réception)', () => {
    expect(subject).toBe('Paiement reçu : 49,00 €');
    expect(subject).not.toContain('✅');
  });
});
