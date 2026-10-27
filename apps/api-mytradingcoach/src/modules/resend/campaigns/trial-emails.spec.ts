import { describe, it, expect, vi } from 'vitest';
import { trialEndedTemplate, trialEndingTemplate, trialEndsIn, trialUsageLine } from './campaign-templates';
import { loadTrialUsage, type CampaignLoadDeps } from './campaign-registry';

// E-mails de l'essai d'inscription (#769, B2) : service, ton neutre, un bouton, désinscription
// « service », aucun montant, ce qui a réellement été utilisé.

const body = (html: string) => html.slice(html.indexOf('<!-- CONTENU -->'), html.indexOf('<!-- FOOTER -->'));
const text = (html: string) => body(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ');
const buttons = (html: string) => (body(html).match(/padding:13px 24px;border-radius:9px/g) ?? []).length;
const ctx = { userName: 'Alex Martin', appUrl: 'https://app.test', unsubUrl: 'U-SERVICE' };
const trial = { endsAt: new Date('2026-11-16T08:00:00Z'), daysLeft: 3, debriefs: 1, alerts: 4, connectedAccounts: 2 };

describe('trial_ending (J+11)', () => {
  const mail = trialEndingTemplate({ ...ctx, trial });
  it('objet et date, rien supprimé ni prélevé, usage réel, un seul bouton vers les offres', () => {
    const t = text(mail.html);
    expect(mail.subject).toBe('Ton Premium offert se termine dans 3 jours');
    expect(t).toContain('ton Premium offert se termine le 16 novembre.');
    expect(t).toContain("rien n'est supprimé et rien n'est prélevé");
    expect(t).toContain('Pendant ton essai : 1 débrief de ta semaine, 4 alertes pendant tes séances, 2 comptes reliés en direct.');
    expect(buttons(mail.html)).toBe(1);
    expect(mail.html).toContain('href="https://app.test/dashboard?plan=premium&amp;cta=email&amp;utm_source=email&amp;utm_medium=onboarding&amp;utm_campaign=trial_ending"'.replace(/&amp;/g, '&'));
    expect(mail.html).toContain('U-SERVICE');
    expect(t).not.toMatch(/€|\d+ ?€/);
  });
  it('rien utilisé : pas de ligne d’usage ; « demain », « aujourd’hui »', () => {
    expect(trialUsageLine({ ...trial, debriefs: 0, alerts: 0, connectedAccounts: 0 })).toBeNull();
    expect(trialUsageLine({ ...trial, debriefs: 0, alerts: 1, connectedAccounts: 1 })).toBe(
      'Pendant ton essai : 1 alerte pendant ta séance, 1 compte relié en direct.',
    );
    expect(trialEndsIn(1)).toBe('demain');
    expect(trialEndsIn(0)).toBe("aujourd'hui");
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

describe('loadTrialUsage', () => {
  it('une lecture groupée par table pour la page ; alertes de séance = risque + comportement', async () => {
    const groupBy = (rows: object[]) => vi.fn().mockResolvedValue(rows);
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', signupTrialEndsAt: trial.endsAt }, { id: 'u2', signupTrialEndsAt: null }]) },
      weeklyDebrief: { groupBy: groupBy([{ userId: 'u1', _count: { _all: 2 } }]) },
      propRiskEvent: { groupBy: groupBy([{ userId: 'u1', _count: { _all: 3 } }]) },
      behaviorAlert: { groupBy: groupBy([{ userId: 'u1', _count: { _all: 1 } }]) },
      brokerConnection: { groupBy: groupBy([]) },
    };
    const map = await loadTrialUsage({ prisma } as unknown as CampaignLoadDeps, ['u1', 'u2'], new Date('2026-11-13T09:00:00Z'));
    expect(map.get('u1')).toEqual({ trial: { endsAt: trial.endsAt, daysLeft: 3, debriefs: 2, alerts: 4, connectedAccounts: 0 } });
    expect(map.has('u2')).toBe(false); // pas d'essai d'inscription : e-mail sans objet
  });
});
