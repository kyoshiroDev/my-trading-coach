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

// A3 (#1013, décision du 14/11) : l'e-mail promettait « accès Premium actif quelques jours » alors
// qu'un abonnement past_due repasse au plan gratuit tout de suite (aucun délai de grâce).
describe('e-mail « Paiement échoué » : accès en pause, pas de délai promis (A3)', () => {
  it('dit que l’accès Premium est en pause, ne promet aucun délai', () => {
    const t = mail(1);
    expect(t).not.toContain('quelques jours');
    expect(t).not.toMatch(/reste actif/);
    expect(t).toContain('Ton accès Premium est en pause');
    expect(t).toContain('tes trades et ton journal restent accessibles');
  });
});
