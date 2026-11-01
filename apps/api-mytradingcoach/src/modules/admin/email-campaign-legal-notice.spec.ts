import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EmailCampaignService } from './email-campaign.service';
import { CAMPAIGNS_BY_KEY } from '../resend/campaigns/campaign-registry';
import { LEGAL_NOTICE_FOOTER, legalNoticeTemplate } from '../resend/campaigns/campaign-templates';

// Information de service « 30 jours avant » (#817) : modification des CGU ou des prix, envoyée à tous
// les comptes réels, sans consentement. Prisma, Resend et Redis sont simulés.

const SUBJECT = 'Évolution de nos conditions générales';
const BODY = 'Nos CGU changent le **1er décembre**.';

function makeService() {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => void store.set(k, v)),
  };
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u1', email: 'a@test.com', name: 'Ana Martin', marketingConsent: true, serviceEmailsOptOutAt: null, unsubToken: 't1' },
        { id: 'u2', email: 'b@test.com', name: null, marketingConsent: false, serviceEmailsOptOutAt: new Date(), unsubToken: null },
      ]),
      count: vi.fn().mockResolvedValue(0),
    },
    emailCampaignLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) },
    emailSend: { create: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([{ sent: 0, connected: 0 }]),
  };
  const dispatch = {
    canSend: vi.fn().mockResolvedValue(true),
    dispatch: vi.fn().mockResolvedValue(true),
    buildUnsubUrl: vi.fn((t: string) => `https://api.test/api/emails/unsubscribe?token=${t}`),
  };
  const resend = { send: vi.fn().mockResolvedValue(undefined) };
  const founders = { publicState: vi.fn() };
  const svc = new EmailCampaignService(
    prisma as never, dispatch as never, resend as never, founders as never, { client: redis } as never,
  );
  return { svc, prisma, dispatch, resend };
}

describe('information de service legal_notice (#817) : campagne et texte', () => {
  it('transactionnelle et manuelle : tous les comptes, sans consentement, 7 jours entre deux envois', () => {
    const c = CAMPAIGNS_BY_KEY.get('legal_notice')!;
    expect(c).toMatchObject({ kind: 'transactional', requiresConsent: false, automated: false, recurringCooldownDays: 7 });
    expect(c.segment(new Date())).toEqual({}); // l'admin ajoute le filtre hors démo et admin
  });

  it('texte saisi, prénom, contact support@ et pied sans lien de désinscription', () => {
    const { subject, html } = legalNoticeTemplate(
      { userName: 'Ana Martin', appUrl: 'https://app.test', unsubUrl: 'UNSUB' },
      { subject: ` ${SUBJECT} `, bodyHtml: '<p>Corps</p>' },
    );
    expect(subject).toBe(SUBJECT);
    expect(html).toContain('Information de service');
    expect(html).toContain('Bonjour Ana,');
    expect(html).toContain('<p>Corps</p>');
    expect(html).toContain('mailto:support@mytradingcoach.app');
    expect(html).toContain(LEGAL_NOTICE_FOOTER);
    expect(html).not.toContain('UNSUB');
    expect(html).not.toContain('hello@');
    expect(html).not.toMatch(/désinscri/i);
  });

  it('objet échappé (contenu saisi dans l’admin)', () => {
    const { html } = legalNoticeTemplate({ userName: '', appUrl: '', unsubUrl: '' }, { subject: '<b>x</b>', bodyHtml: '' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('Bonjour,');
  });
});

describe('information de service legal_notice (#817) : envoi', () => {
  it('objet et texte obligatoires, au test comme à l’envoi', async () => {
    const { svc, resend, dispatch } = makeService();
    await expect(svc.sendTest('legal_notice', '', BODY)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.sendTest('legal_notice', SUBJECT, '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.send('legal_notice', 'admin', SUBJECT, '')).rejects.toBeInstanceOf(BadRequestException);
    expect(resend.send).not.toHaveBeenCalled();
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('envoi réel refusé tant que le contenu actuel n’a pas été testé', async () => {
    const { svc, dispatch } = makeService();
    await expect(svc.send('legal_notice', 'admin', SUBJECT, BODY)).rejects.toThrow(/Envoie d'abord un test/);
    await svc.sendTest('legal_notice', SUBJECT, BODY);
    // Texte modifié après le test : nouveau test exigé.
    await expect(svc.send('legal_notice', 'admin', SUBJECT, `${BODY} Modifié.`)).rejects.toThrow(/Envoie d'abord un test/);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('envoi test : sujet [TEST], texte rendu, aucun EmailSend', async () => {
    const { svc, resend, prisma } = makeService();
    const res = await svc.sendTest('legal_notice', SUBJECT, BODY);
    expect(res.subject).toBe(`[TEST] ${SUBJECT}`);
    const mail = resend.send.mock.calls[0][0];
    expect(mail.html).toContain('Bonjour Alex,');
    expect(mail.html).toContain('1er décembre</strong>');
    expect(mail.headers).toBeUndefined(); // pas de désinscription en un clic
    expect(prisma.emailSend.create).not.toHaveBeenCalled();
  });

  it('après le test : chaque compte reçoit le texte saisi, sans condition de consentement', async () => {
    const { svc, prisma, dispatch } = makeService();
    await svc.sendTest('legal_notice', SUBJECT, BODY);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const pending = svc.send('legal_notice', 'admin-1', SUBJECT, BODY);
    await vi.runAllTimersAsync();
    const res = await pending;
    vi.useRealTimers();

    expect(res).toEqual({ success: 2, errors: 0, skipped: 0 });
    // Cible = tous les comptes réels : segment vide + filtre hors démo et admin.
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ AND: [{}, { isDemo: false, role: { not: 'ADMIN' } }] });
    expect(dispatch.dispatch).toHaveBeenCalledTimes(2);
    const [campaign, user, override] = dispatch.dispatch.mock.calls[0];
    expect(campaign.key).toBe('legal_notice');
    expect(user.id).toBe('u1');
    const content = override('UNSUB');
    expect(content.subject).toBe(SUBJECT);
    expect(content.html).toContain('Bonjour Ana,');
    expect(content.html).toContain('1er décembre</strong>');
    expect(prisma.emailCampaignLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'legal_notice', subject: SUBJECT, sentBy: 'admin-1', successCount: 2 }),
    });
  });
});
