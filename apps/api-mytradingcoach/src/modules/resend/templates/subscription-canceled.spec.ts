import { describe, it, expect } from 'vitest';
import { subscriptionCanceledTemplate } from './index';

// E-mail « Abonnement résilié » (#845) : texte standard, ou variante datée quand l'essai
// d'inscription continue après la résiliation. Jamais de mention de remboursement.
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = { userName: 'Ana', resubscribeUrl: 'https://app.test/billing' };
// 23:30 UTC le 14/11 = 00:30 le 15/11 à Paris : la date affichée est celle de Paris.
const until = new Date('2026-11-14T23:30:00Z');

describe('subscriptionCanceledTemplate', () => {
  it('standard : plan gratuit', () => {
    const t = text(subscriptionCanceledTemplate(base).html);
    expect(t).toContain('Bonjour Ana, ton abonnement Premium a bien été résilié.');
    expect(t).toContain('Tu es maintenant sur le plan gratuit');
  });

  it('essai d’inscription en cours, jamais payé : date de Paris, « Aucun prélèvement. »', () => {
    const t = text(subscriptionCanceledTemplate({ ...base, offered: { until, paid: false } }).html);
    expect(t).toContain("Bonjour Ana, ton abonnement est résilié. Ton Premium offert continue jusqu'au 15/11. Aucun prélèvement.");
    expect(t).not.toContain('plan gratuit');
    expect(t).not.toMatch(/rembours/i);
  });

  it('essai d’inscription en cours, déjà payé : « Aucun nouveau prélèvement. »', () => {
    const t = text(subscriptionCanceledTemplate({ ...base, offered: { until, paid: true } }).html);
    expect(t).toContain("Ton Premium offert continue jusqu'au 15/11. Aucun nouveau prélèvement.");
    expect(t).not.toMatch(/rembours/i);
  });
});
