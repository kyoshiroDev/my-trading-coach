import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailDispatchService } from './email-dispatch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from './resend.service';
import { EmailCampaign } from './campaigns/campaign-registry';

const DAY = 24 * 3600e3;

// Fabriques de campagnes de test (build/segment factices).
const baseCampaign = (over: Partial<EmailCampaign>): EmailCampaign => ({
  key: 'test',
  label: 'Test',
  description: '',
  kind: 'marketing',
  requiresConsent: true,
  automated: false,
  priority: 1,
  segment: () => ({}),
  build: () => ({ subject: 'S', html: '<p>H</p>' }),
  ...over,
});

// Mock Prisma : findFirst distingue la requête "oneShot" (campaignKey) de la
// requête "plafond marketing" (kind) via le where reçu.
const lastForCampaign = vi.fn();
const lastMarketing = vi.fn();

const mockPrisma = {
  emailSend: {
    findFirst: vi.fn((args: { where: Record<string, unknown> }) =>
      'campaignKey' in args.where ? lastForCampaign(args) : lastMarketing(args),
    ),
    create: vi.fn().mockResolvedValue({}),
  },
  user: { update: vi.fn().mockResolvedValue({}) },
};

const mockResend = { send: vi.fn().mockResolvedValue(undefined) };

const mockConfig = {
  get: vi.fn((k: string) => {
    if (k === 'MARKETING_COOLDOWN_DAYS') return 4;
    if (k === 'FRONTEND_URL') return 'https://app.test';
    if (k === 'API_URL') return 'https://api.test';
    return undefined;
  }),
};

describe('EmailDispatchService', () => {
  let service: EmailDispatchService;

  beforeEach(async () => {
    vi.clearAllMocks();
    lastForCampaign.mockResolvedValue(null);
    lastMarketing.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [
        EmailDispatchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ResendService, useValue: mockResend },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(EmailDispatchService);
  });

  it('refuse si requiresConsent et pas de consentement', async () => {
    const campaign = baseCampaign({ requiresConsent: true });
    const ok = await service.canSend(campaign, { id: 'u1', marketingConsent: false });
    expect(ok).toBe(false);
  });

  it('refuse un oneShot déjà envoyé', async () => {
    const campaign = baseCampaign({ kind: 'transactional', requiresConsent: false });
    lastForCampaign.mockResolvedValue({ sentAt: new Date(Date.now() - 30 * DAY) });
    const ok = await service.canSend(campaign, { id: 'u1', marketingConsent: false });
    expect(ok).toBe(false);
  });

  it('respecte le plafond marketing (2e marketing dans la fenêtre = refusé)', async () => {
    // recurring (cooldown 1j) pour ne pas être bloqué par l'anti-doublon oneShot
    const campaign = baseCampaign({ requiresConsent: false, recurringCooldownDays: 1 });
    lastForCampaign.mockResolvedValue(null); // jamais reçu cette campagne
    lastMarketing.mockResolvedValue({ sentAt: new Date(Date.now() - 1 * 3600e3) }); // marketing il y a 1h
    const ok = await service.canSend(campaign, { id: 'u1', marketingConsent: true });
    expect(ok).toBe(false);
  });

  it('transactionnel non plafonné', async () => {
    const campaign = baseCampaign({ kind: 'transactional', requiresConsent: false });
    lastForCampaign.mockResolvedValue(null);
    // même avec un marketing récent, le transactionnel n'interroge pas le plafond
    lastMarketing.mockResolvedValue({ sentAt: new Date() });
    const ok = await service.canSend(campaign, { id: 'u1', marketingConsent: false });
    expect(ok).toBe(true);
    expect(lastMarketing).not.toHaveBeenCalled();
  });

  it('recurring renvoyé après cooldown', async () => {
    const campaign = baseCampaign({ kind: 'transactional', requiresConsent: false, recurringCooldownDays: 2 });
    // dernier envoi il y a 3 jours > cooldown 2j → autorisé
    lastForCampaign.mockResolvedValue({ sentAt: new Date(Date.now() - 3 * DAY) });
    const ok = await service.canSend(campaign, { id: 'u1', marketingConsent: true });
    expect(ok).toBe(true);

    // dernier envoi il y a 1 jour < cooldown 2j → refusé
    lastForCampaign.mockResolvedValue({ sentAt: new Date(Date.now() - 1 * DAY) });
    const ko = await service.canSend(campaign, { id: 'u1', marketingConsent: true });
    expect(ko).toBe(false);
  });

  it('force ignore le oneShot mais jamais le consentement', async () => {
    const campaign = baseCampaign({ requiresConsent: true, kind: 'transactional' });
    lastForCampaign.mockResolvedValue({ sentAt: new Date() }); // déjà envoyé
    // force + consentement → autorisé malgré le oneShot
    expect(await service.canSend(campaign, { id: 'u1', marketingConsent: true }, { force: true })).toBe(true);
    // force mais SANS consentement → toujours refusé
    expect(await service.canSend(campaign, { id: 'u1', marketingConsent: false }, { force: true })).toBe(false);
  });

  it('dispatch envoie, logge et génère un unsubToken si absent', async () => {
    const campaign = baseCampaign({ key: 'k1', kind: 'marketing' });
    const sent = await service.dispatch(campaign, {
      id: 'u1',
      email: 'a@test.com',
      name: 'Alice',
      marketingConsent: true,
      unsubToken: null,
    });
    expect(sent).toBe(true);
    expect(mockResend.send).toHaveBeenCalledOnce();
    expect(mockPrisma.user.update).toHaveBeenCalled(); // unsubToken lazy
    expect(mockPrisma.emailSend.create).toHaveBeenCalledWith({
      data: { campaignKey: 'k1', userId: 'u1', kind: 'marketing' },
    });
  });
});
