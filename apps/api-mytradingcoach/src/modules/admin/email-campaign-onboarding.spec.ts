import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailCampaignService } from './email-campaign.service';

// Admin des campagnes : la suite d'onboarding apparaît dans la liste (libellé avec le jour, envois,
// taux de connexion Tradovate sous 3 jours), et l'envoi manuel charge les données comme le cron.

function makeService(over: { open?: boolean } = {}) {
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'a', email: 'a@test.com', name: 'Ana', marketingConsent: true, serviceEmailsOptOutAt: null, unsubToken: 't' },
        { id: 'b', email: 'b@test.com', name: null, marketingConsent: true, serviceEmailsOptOutAt: null, unsubToken: 't' },
      ]),
      count: vi.fn().mockResolvedValue(5),
    },
    emailCampaignLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    emailSend: {
      groupBy: vi.fn().mockResolvedValue([
        { campaignKey: 'connect_tradovate', _count: { _all: 40 } },
        { campaignKey: 'prop_firm_rules', _count: { _all: 12 } },
      ]),
    },
    // Taux de connexion (connect_tradovate) OU bilan J0-J7 (first_week_recap) selon l'appel.
    $queryRaw: vi.fn().mockResolvedValue([{ sent: 30, connected: 9 }]),
    propFirm: { count: vi.fn().mockResolvedValue(16) },
  };
  const dispatch = {
    canSend: vi.fn().mockResolvedValue(true),
    dispatch: vi.fn().mockResolvedValue(true),
    buildUnsubUrl: vi.fn((t: string, scope?: string) => `https://api.test/u?token=${t}${scope ? `&scope=${scope}` : ''}`),
  };
  const resend = { send: vi.fn().mockResolvedValue(undefined) };
  const founders = {
    publicState: vi.fn().mockResolvedValue({ open: over.open ?? true, seatsLeft: 150, seatsTotal: 200 }),
  };
  const redis = { get: vi.fn().mockResolvedValue(null), setex: vi.fn() };
  const svc = new EmailCampaignService(
    prisma as never, dispatch as never, resend as never, founders as never, { client: redis } as never,
  );
  return { svc, prisma, dispatch, resend };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] }); // pause de 150 ms entre deux envois manuels
  vi.stubEnv('ONBOARDING_SEQUENCE_START', '2026-11-01T00:00:00Z');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const flush = async <T>(p: Promise<T>) => {
  await vi.runAllTimersAsync();
  return p;
};

describe('liste des campagnes', () => {
  it('la suite d’onboarding en tête : libellé avec le jour, envois, type service sans consentement', async () => {
    const { svc } = makeService();
    const list = await svc.listCampaigns();
    expect(list.slice(0, 4).map((c) => c.label)).toEqual([
      'Connecter Tradovate (J+1)',
      'Choisir sa firme et son plan (J+4)',
      'Bilan de la 1re semaine (J+7)',
      'Offre fondateur (J+10)',
    ]);
    const connect = list.find((c) => c.type === 'connect_tradovate')!;
    expect(connect).toMatchObject({ kind: 'service', requiresConsent: false, automated: true, sentTotal: 40 });
    expect(connect.withConsent).toBe(connect.targetCount); // service : tout le segment est joignable
    expect(connect.withoutConsent).toBe(0);
    expect(list.find((c) => c.type === 'prop_firm_rules')!.sentTotal).toBe(12);
    expect(list.find((c) => c.type === 'first_week_recap')!.sentTotal).toBe(0);
    expect(list.find((c) => c.type === 'first_trade_nudge')).toMatchObject({ automated: false });
  });

  it('taux de connexion Tradovate sous 3 jours : connect_tradovate seulement, une requête', async () => {
    const { svc, prisma } = makeService();
    const list = await svc.listCampaigns();
    expect(list.find((c) => c.type === 'connect_tradovate')!.connectedWithin3d).toEqual({ connected: 9, sent: 30 });
    expect(list.filter((c) => c.connectedWithin3d !== null)).toHaveLength(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('aperçu et test', () => {
  it('prop_firm_rules : nombre réel de firmes, lien « ne plus recevoir ces conseils »', async () => {
    const { svc, resend } = makeService();
    await svc.sendTest('prop_firm_rules');
    const mail = resend.send.mock.calls[0][0];
    expect(mail.subject).toBe('[TEST] Ta marge restante, avec les vraies règles de ta firme');
    expect(mail.html).toContain('16 prop firms sont déjà intégrées.');
    expect(mail.html).toContain('token=envoi-test&scope=service');
  });

  it('first_week_recap : bilan d’exemple, jamais les chiffres d’un vrai utilisateur', async () => {
    const { svc } = makeService();
    const { html } = await svc.preview('first_week_recap');
    expect(html).toContain('12 trades, 4 jours de trading, P&amp;L +$340.00');
  });
});

describe('envoi manuel', () => {
  it('founder_followup : offre fermée → personne (vérifié à l’envoi)', async () => {
    const { svc, dispatch } = makeService({ open: false });
    const res = await flush(svc.send('founder_followup', 'admin'));
    expect(res).toEqual({ success: 0, errors: 0, skipped: 2 });
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('founder_followup : offre ouverte → places passées à chaque e-mail', async () => {
    const { svc, dispatch } = makeService();
    const res = await flush(svc.send('founder_followup', 'admin'));
    expect(res.success).toBe(2);
    expect(dispatch.dispatch.mock.calls[0][3]).toEqual({ seatsLeft: 150, seatsTotal: 200 });
  });

  it('first_week_recap : sans trade sur J0-J7 → pas d’e-mail', async () => {
    const { svc, prisma, dispatch } = makeService();
    prisma.$queryRaw.mockResolvedValue([{ userId: 'a', trades: 3, days: 2, net: 50, currencies: ['USD'] }]);
    const res = await flush(svc.send('first_week_recap', 'admin'));
    expect(res).toEqual({ success: 1, errors: 0, skipped: 1 });
    expect(dispatch.dispatch.mock.calls[0][1].id).toBe('a');
    expect(dispatch.dispatch.mock.calls[0][3]).toEqual({ firstWeek: { trades: 3, days: 2, pnl: '+$50.00' } });
  });
});
