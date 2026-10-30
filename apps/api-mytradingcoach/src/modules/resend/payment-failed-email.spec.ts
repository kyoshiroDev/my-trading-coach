import { describe, it, expect } from 'vitest';
import { paymentFailedTemplate } from './templates';

// « Paiement échoué » (#792) : la mention de la tentative, vide à la première, ne laisse pas d'espace
// avant le point.

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ');
const mail = (attemptCount: number) =>
  text(paymentFailedTemplate({ userName: 'Alex', attemptCount, portalUrl: 'https://portal.test' }).html);

describe('e-mail « Paiement échoué »', () => {
  it('première tentative : « ton paiement. », sans mention ni espace avant le point', () => {
    const t = mail(1);
    expect(t).toContain("nous n'avons pas pu traiter ton paiement.");
    expect(t).not.toContain('paiement .');
    expect(t).not.toContain('tentative');
  });

  it('à partir de la 2e : « ton paiement (tentative N). »', () => {
    const t = mail(3);
    expect(t).toContain('traiter ton paiement (tentative 3).');
    expect(t).not.toMatch(/\) \./);
  });
});
