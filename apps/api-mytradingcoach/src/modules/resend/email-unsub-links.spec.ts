import { describe, it, expect } from 'vitest';
import { connectTradovateTemplate, premiumTemplate, trialEndedTemplate, trialEndingTemplate } from './campaigns/campaign-templates';
import { paymentFailedTemplate } from './templates';

// Liens de désinscription (#769) : UN SEUL lien qui désinscrit par e-mail, celui du texte ; le pied
// mène aux préférences (« Gérer mes e-mails »), comme pour les e-mails liés au compte. Les règles
// d'envoi ne changent pas : service = aide au démarrage seulement, marketing = marketing + aide.

const UNSUB_SERVICE = 'https://api.test/api/emails/unsubscribe?token=t&scope=service';
const UNSUB_MKT = 'https://api.test/api/emails/unsubscribe?token=t';
const ctx = { userName: 'Alex', appUrl: 'https://app.test' };
const unsubLinks = (html: string) => html.match(/\/api\/emails\/unsubscribe\?/g)?.length ?? 0;
const manageLink = (html: string) =>
  /<a href="[^"]+\/profil\?tab=params"[^>]*>Gérer mes e-mails<\/a>/.test(html);

describe('un seul lien de désinscription par e-mail', () => {
  const service = [
    ['J+11', trialEndingTemplate({ ...ctx, unsubUrl: UNSUB_SERVICE, trial: { endsAt: new Date('2026-11-16T08:00:00Z') } })],
    ['fin d’essai', trialEndedTemplate({ ...ctx, unsubUrl: UNSUB_SERVICE })],
    ['Tradovate J+1', connectTradovateTemplate({ ...ctx, unsubUrl: UNSUB_SERVICE })],
  ] as const;

  it.each(service)('service (%s) : « Ne plus recevoir les e-mails d’aide au démarrage », un seul lien, pied « Gérer mes e-mails »', (_l, mail) => {
    expect(unsubLinks(mail.html)).toBe(1);
    expect(mail.html).toContain(`<a href="${UNSUB_SERVICE}" style="color:#9db4ce;text-decoration:underline;">Ne plus recevoir les e-mails d'aide au démarrage</a>`);
    expect(manageLink(mail.html)).toBe(true);
    expect(mail.html).not.toContain('Se désabonner');
  });

  it('marketing : « Me désinscrire des emails » (libellé inchangé), un seul lien, pied « Gérer mes e-mails »', () => {
    const mail = premiumTemplate({ ...ctx, unsubUrl: UNSUB_MKT });
    expect(unsubLinks(mail.html)).toBe(1);
    expect(mail.html).toContain(`<a href="${UNSUB_MKT}" style="color:#9db4ce;text-decoration:underline;">Me désinscrire des emails</a>`);
    expect(manageLink(mail.html)).toBe(true);
    expect(mail.html).not.toContain('Se désabonner');
  });

  it('transactionnel (paiement échoué) : aucun lien de désinscription, pied « Gérer mes e-mails » inchangé', () => {
    const mail = paymentFailedTemplate({ userName: 'Alex', attemptCount: 1, portalUrl: 'https://billing.test' });
    expect(unsubLinks(mail.html)).toBe(0);
    expect(manageLink(mail.html)).toBe(true);
  });
});
