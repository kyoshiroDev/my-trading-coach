import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EmailCampaignService } from './email-campaign.service';
import { CAMPAIGNS_BY_KEY } from '../resend/campaigns/campaign-registry';
import { founderLaunchTemplate, founderLaunchUrl } from '../resend/campaigns/campaign-templates';

// Campagne founder_launch (#525) : ciblage, texte, envoi test obligatoire et refus si l'offre ne vend
// pas. Prisma, Resend, Redis et l'offre fondateur sont simulés.

function makeService(over: { open?: boolean; seatsLeft?: number } = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => void store.set(k, v)),
  };
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u1', email: 'a@test.com', name: 'Ana', marketingConsent: true, unsubToken: 't1' },
        { id: 'u2', email: 'b@test.com', name: null, marketingConsent: false, unsubToken: null },
      ]),
      count: vi.fn().mockResolvedValue(0),
    },
    emailCampaignLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    emailSend: { create: vi.fn() },
  };
  const dispatch = {
    canSend: vi.fn(async (_c: unknown, u: { marketingConsent: boolean }) => u.marketingConsent),
    dispatch: vi.fn().mockResolvedValue(true),
    buildUnsubUrl: vi.fn((t: string) => `https://api.test/api/emails/unsubscribe?token=${t}`),
  };
  const resend = { send: vi.fn().mockResolvedValue(undefined) };
  const founders = {
    publicState: vi.fn().mockResolvedValue({ open: over.open ?? true, seatsLeft: over.seatsLeft ?? 187 }),
  };
  const svc = new EmailCampaignService(
    prisma as never, dispatch as never, resend as never, founders as never, { client: redis } as never,
  );
  return { svc, prisma, dispatch, resend, redis };
}

describe('campagne founder_launch : ciblage et texte', () => {
  it('cible les inscrits non abonnés, hors fondateurs, codes partenaires actifs et bêta-testeurs', () => {
    const c = CAMPAIGNS_BY_KEY.get('founder_launch')!;
    expect(c).toMatchObject({ kind: 'marketing', requiresConsent: true, automated: false });
    expect(c.recurringCooldownDays).toBeUndefined(); // oneShot
    expect(c.segment(new Date())).toEqual({
      AND: [
        { role: { not: 'BETA_TESTER' } },
        { OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { notIn: ['active', 'past_due'] } }] },
        { founderSeat: { is: null } },
        { NOT: { partnerRedemption: { is: { status: 'ACTIVE' } } } },
      ],
    });
  });

  it('texte validé : objet, prénom (ou « Salut, »), places restantes, lien direct dans l’app avec cta=email', () => {
    const named = founderLaunchTemplate({ userName: 'Ana', appUrl: 'https://app.test/', unsubUrl: 'U', seatsLeft: 187 });
    expect(named.subject).toBe('200 places à 29 €/mois, à vie');
    expect(named.html).toContain('Salut Ana,');
    expect(named.html).toContain('187 places sur 200');
    expect(named.html).toContain('Premier arrivé, premier servi.');
    expect(named.html).toContain('Le trading comporte un risque de perte en capital.');
    expect(named.html).toContain('href="U"'); // désinscription
    // Lettre de Greg : sa signature (logo intégré), expéditeur support@, réponses sur hello@, version texte.
    expect(named.html).toContain('Grégory');
    expect(named.html).toContain('src="cid:logo-mtc"');
    expect(named.html).not.toContain('Greg, fondateur de MyTradingCoach'); // pas de double signature
    expect(named).toMatchObject({
      from: 'Grégory · MyTradingCoach <support@mytradingcoach.app>',
      replyTo: 'hello@mytradingcoach.app',
      attachments: [expect.objectContaining({ contentId: 'logo-mtc', filename: 'logo.png' })],
    });
    expect(named.text).toContain('Salut Ana,');
    expect(named.text).toContain('Il reste 187 places sur 200.');
    expect(named.text).toContain('Grégory');
    expect(named.text!.indexOf('P.S.')).toBeGreaterThan(named.text!.indexOf('Grégory'));
    expect(named.text).toContain('Me désinscrire des e-mails : U');
    expect(founderLaunchTemplate({ userName: '<b>x</b>', appUrl: '', unsubUrl: 'U' }).html).toContain('Salut &lt;b&gt;x&lt;/b&gt;,');
    expect(named.html).toContain('jusqu&#39;à 240 € économisés par an'.replace('&#39;', "'"));
    expect(named.html).toContain('Quand elles sont parties, c&#39;est 49 €.'.replace('&#39;', "'"));
    expect(named.html).toContain('<b>P.S.</b>');
    // Les destinataires ont un compte : lien direct dans l'app, l'intention survit à la connexion.
    const url = 'https://app.test/dashboard?plan=founder&cta=email&utm_source=email&utm_medium=campaign&utm_campaign=fondateur';
    expect(founderLaunchUrl('https://app.test/')).toBe(url);
    expect(named.html.split(url).length - 1).toBe(2); // bouton + P.S.
    expect(named.text).toContain(`Je prends ma place fondateur : ${url}`);
    expect(founderLaunchTemplate({ userName: '', appUrl: '', unsubUrl: 'U' }).html).toContain('Salut,');
    expect(founderLaunchTemplate({ userName: '  Greg Tahir ', appUrl: '', unsubUrl: 'U' }).html).toContain('Salut Greg,');
  });
});

describe('campagne founder_launch : envoi test et envoi réel', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('envoi test : un seul e-mail vers hello@, sujet [TEST], mêmes places, aucun EmailSend', async () => {
    const { svc, resend, dispatch, prisma } = makeService({ seatsLeft: 187 });
    const res = await svc.sendTest('founder_launch');
    expect(res).toEqual({ to: 'hello@mytradingcoach.app', subject: '[TEST] 200 places à 29 €/mois, à vie' });
    expect(resend.send).toHaveBeenCalledTimes(1);
    const mail = resend.send.mock.calls[0][0];
    expect(mail.to).toBe('hello@mytradingcoach.app');
    expect(mail.html).toContain('Salut Alex,');
    expect(mail.html).toContain('187 places sur 200');
    expect(mail).toMatchObject({ from: 'Grégory · MyTradingCoach <support@mytradingcoach.app>', replyTo: 'hello@mytradingcoach.app' });
    expect(mail.attachments).toHaveLength(1);
    expect(mail.text).toContain('Salut Alex,');
    expect(dispatch.dispatch).not.toHaveBeenCalled();
    expect(prisma.emailSend.create).not.toHaveBeenCalled();
    expect(prisma.emailCampaignLog.create).not.toHaveBeenCalled();
  });

  it('adresse de test = configuration CAMPAIGN_TEST_EMAIL', async () => {
    vi.stubEnv('CAMPAIGN_TEST_EMAIL', 'qa@mytradingcoach.app');
    const { svc, resend } = makeService();
    await svc.sendTest('founder_launch');
    expect(resend.send.mock.calls[0][0].to).toBe('qa@mytradingcoach.app');
  });

  it('envoi réel refusé sans test sur le contenu actuel (vérifié côté serveur)', async () => {
    const { svc, dispatch } = makeService();
    await expect(svc.send('founder_launch', 'admin')).rejects.toThrow(BadRequestException);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('contenu modifié depuis le test → nouveau test exigé', async () => {
    const { svc, redis, dispatch } = makeService();
    await svc.sendTest('founder_launch');
    redis.get.mockResolvedValueOnce('ancienne-empreinte');
    await expect(svc.send('founder_launch', 'admin')).rejects.toThrow(/test/);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('offre fermée ou complète → envoi refusé, même après un test', async () => {
    const closed = makeService({ open: false });
    await closed.svc.sendTest('founder_launch');
    await expect(closed.svc.send('founder_launch', 'admin')).rejects.toThrow(/fermée ou complète/);
    const full = makeService({ seatsLeft: 0 });
    await full.svc.sendTest('founder_launch');
    await expect(full.svc.send('founder_launch', 'admin')).rejects.toThrow(/fermée ou complète/);
  });

  it('après le test : envoi aux seuls consentants via EmailDispatch, places figées à l’envoi', async () => {
    const { svc, dispatch } = makeService({ seatsLeft: 150 });
    await svc.sendTest('founder_launch');
    const res = await svc.send('founder_launch', 'admin');
    expect(res).toEqual({ success: 1, errors: 0, skipped: 1 });
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.dispatch.mock.calls[0][1]).toMatchObject({ id: 'u1' });
    expect(dispatch.dispatch.mock.calls[0][3]).toEqual({ seatsLeft: 150 });
  }, 10_000);

  it('liste : ciblés avec et sans consentement, test exigé, test à jour ou non', async () => {
    const { svc, prisma } = makeService();
    prisma.user.count.mockImplementation(async ({ where }: { where: { AND?: unknown[] } }) =>
      JSON.stringify(where).includes('marketingConsent') ? 30 : 100,
    );
    const before = (await svc.listCampaigns()).find((c) => c.type === 'founder_launch')!;
    expect(before).toMatchObject({ targetCount: 100, withConsent: 30, withoutConsent: 70, requiresTest: true, testedCurrent: false, testEmail: 'hello@mytradingcoach.app' });
    await svc.sendTest('founder_launch');
    const after = (await svc.listCampaigns()).find((c) => c.type === 'founder_launch')!;
    expect(after.testedCurrent).toBe(true);
    expect((await svc.listCampaigns()).find((c) => c.type === 'premium_upsell')!.requiresTest).toBe(false);
  });
});
