import { describe, it, expect, vi } from 'vitest';
import { trialEndedTemplate, trialEndingTemplate } from './campaign-templates';
import { loadTrialEnd, type CampaignLoadDeps } from './campaign-registry';

// E-mails de l'essai d'inscription (#769, B2) : service, ton neutre, un bouton, désinscription
// « service », aucun montant.

const body = (html: string) => html.slice(html.indexOf('<!-- CONTENU -->'), html.indexOf('<!-- FOOTER -->'));
const text = (html: string) => body(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ');
const buttons = (html: string) => (body(html).match(/padding:13px 24px;border-radius:9px/g) ?? []).length;
const ctx = { userName: 'Alex Martin', appUrl: 'https://app.test', unsubUrl: 'U-SERVICE' };
const trial = { endsAt: new Date('2026-11-16T08:00:00Z') };

describe('trial_ending (J+11)', () => {
  const mail = trialEndingTemplate({ ...ctx, trial });
  it('service neutre : date de fin, ce qui change, rien supprimé ni prélevé, bouton vers l’abonnement', () => {
    const t = text(mail.html);
    expect(mail.subject).toBe('Ton Premium offert se termine le 16 novembre');
    expect(t).toContain('ton Premium offert se termine le 16 novembre.');
    expect(t).toContain("rien n'est supprimé et rien n'est prélevé");
    expect(t).toContain("Ce qui change en gratuit : les alertes avant ta limite, l'anti-tilt en direct et le débrief de ta semaine s'arrêtent.");
    expect(t).toContain('Tu gardes ton journal, tout ton historique, la synchro Tradovate');
    expect(buttons(mail.html)).toBe(1);
    expect(t).toContain('Voir mon abonnement');
    expect(mail.html).toContain('href="https://app.test/profil?tab=params&utm_source=email&utm_medium=onboarding&utm_campaign=trial_ending"');
    expect(mail.html).toContain('U-SERVICE');
  });
  it('aucun ton promotionnel ni urgence : ni offre, ni prix, ni compte à rebours', () => {
    const t = text(mail.html) + ' ' + mail.subject;
    expect(t).not.toMatch(/€|offre|plan=premium|dans \d+ jours|demain|vite|dernier|profite|ne rate/i);
  });
});

describe('trial_ended (fin d’essai)', () => {
  it('ton neutre, rien supprimé, un bouton, désinscription service, aucun montant', () => {
    const mail = trialEndedTemplate(ctx);
    const t = text(mail.html);
    expect(mail.subject).toBe('Ton Premium offert est terminé');
    expect(t).toContain('ton compte est repassé en gratuit');
    expect(t).toContain("rien n'est supprimé");
    expect(buttons(mail.html)).toBe(1);
    expect(mail.html).toContain('U-SERVICE');
    expect(t).not.toMatch(/€/);
  });
});

describe('loadTrialEnd', () => {
  it('une seule lecture pour la page ; sans essai d’inscription, pas de contexte', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'u1', signupTrialEndsAt: trial.endsAt }, { id: 'u2', signupTrialEndsAt: null }]);
    const map = await loadTrialEnd({ prisma: { user: { findMany } } } as unknown as CampaignLoadDeps, ['u1', 'u2']);
    expect(map.get('u1')).toEqual({ trial: { endsAt: trial.endsAt } });
    expect(map.has('u2')).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
