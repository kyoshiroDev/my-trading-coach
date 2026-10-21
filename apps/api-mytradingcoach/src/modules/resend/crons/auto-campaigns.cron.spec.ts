import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/prisma/prisma.service';
import { EmailDispatchService } from '../email-dispatch.service';
import { FounderOfferService } from '../../founder-offer/founder-offer.service';

// Registre mocké : 2 campagnes automatisées ciblant le même user (+ une à données, désactivée
// par défaut, que les tests activent).
const { withContext, startDate } = vi.hoisted(() => ({
  withContext: { enabled: false, load: (() => Promise.resolve(new Map())) as (...a: unknown[]) => Promise<Map<string, unknown>> },
  startDate: { value: new Date('2026-11-01') as Date | null },
}));
vi.mock('../campaigns/campaign-registry', () => {
  const make = (key: string, priority: number) => ({
    key,
    label: key,
    description: '',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority,
    segment: () => ({}),
    build: () => ({ subject: 's', html: '<p>h</p>' }),
  });
  const ctx = {
    ...make('ctx', 200),
    get automated() { return withContext.enabled; },
    loadContext: (...a: unknown[]) => withContext.load(...a),
  };
  return { CAMPAIGNS: [make('low', 50), make('high', 100), ctx], onboardingStart: () => startDate.value };
});

import { AutoCampaignsCron } from './auto-campaigns.cron';

const mockPrisma = { user: { findMany: vi.fn() } };
const mockDispatch = {
  allowedUsers: vi.fn(async (_c: unknown, users: { id: string }[]) => new Set(users.map((u) => u.id))),
  dispatch: vi.fn().mockResolvedValue(true),
};

describe('AutoCampaignsCron', () => {
  let cron: AutoCampaignsCron;
  let nodeEnv = 'production';

  beforeEach(async () => {
    vi.clearAllMocks();
    nodeEnv = 'production';
    withContext.enabled = false;
    startDate.value = new Date('2026-11-01');
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@test.com', name: 'Alice', marketingConsent: true, unsubToken: 't' },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        AutoCampaignsCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailDispatchService, useValue: mockDispatch },
        { provide: ConfigService, useValue: { get: vi.fn((k: string) => (k === 'NODE_ENV' ? nodeEnv : undefined)) } },
        { provide: FounderOfferService, useValue: { publicState: vi.fn().mockResolvedValue({ open: true, seatsLeft: 150, seatsTotal: 200 }) } },
      ],
    }).compile();

    cron = module.get(AutoCampaignsCron);
  });

  it('ne fait rien hors production', async () => {
    nodeEnv = 'development';
    await cron.run();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockDispatch.dispatch).not.toHaveBeenCalled();
  });

  it('un user matchant 2 campagnes ne reçoit qu\'un seul email (la plus prioritaire)', async () => {
    await cron.run();
    expect(mockDispatch.dispatch).toHaveBeenCalledTimes(1);
    // la campagne prioritaire ('high', priority 100) part en premier
    expect(mockDispatch.dispatch.mock.calls[0][0].key).toBe('high');
  });

  it('exclut les comptes admin et démo du segment', async () => {
    await cron.run();
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    const guard = where.AND.find((c: Record<string, unknown>) => 'isDemo' in c);
    expect(guard.isDemo).toBe(false);
    expect(guard.role).toEqual({ not: 'ADMIN' });
  });

  it('parcourt les utilisateurs par pages de 500 avec un curseur (SCA-B5-07)', async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({
      id: `u${String(i).padStart(3, '0')}`, email: 'x@test.com', name: null, marketingConsent: true, unsubToken: 't',
    }));
    mockPrisma.user.findMany.mockReset().mockResolvedValueOnce(page).mockResolvedValueOnce([]).mockResolvedValue([]);

    await cron.run();

    const calls = mockPrisma.user.findMany.mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ take: 500, orderBy: { id: 'asc' } });
    expect(calls[1]).toMatchObject({ cursor: { id: 'u499' }, skip: 1 });
  });

  it('seuls les utilisateurs autorisés par allowedUsers reçoivent l’e-mail', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'ok', email: 'a@test.com', name: null, marketingConsent: true, unsubToken: 't' },
      { id: 'refuse', email: 'b@test.com', name: null, marketingConsent: true, unsubToken: 't' },
    ]);
    mockDispatch.allowedUsers.mockResolvedValue(new Set(['ok']));

    await cron.run();

    expect(mockDispatch.dispatch.mock.calls.map((c) => c[1].id)).toEqual(['ok']);
  });

  it('loadContext : une lecture pour la page autorisée, données passées à l’e-mail, absent = pas d’envoi', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'avec', email: 'a@test.com', name: null, marketingConsent: true, unsubToken: 't' },
      { id: 'sans', email: 'b@test.com', name: null, marketingConsent: true, unsubToken: 't' },
    ]);
    mockDispatch.allowedUsers.mockImplementation(async (_c: unknown, users: { id: string }[]) => new Set(users.map((u) => u.id)));
    const load = vi.fn(async (..._args: unknown[]) => new Map([['avec', { propFirmCount: 16 }]]));
    withContext.load = load;
    withContext.enabled = true;

    await cron.run();

    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0][1]).toEqual(['avec', 'sans']);
    const ctxCalls = mockDispatch.dispatch.mock.calls.filter((c) => c[0].key === 'ctx');
    expect(ctxCalls.map((c) => [c[1].id, c[3]])).toEqual([['avec', { propFirmCount: 16 }]]);
    // « sans » n'a pas reçu ctx : il reste disponible pour la campagne suivante du même passage
    expect(mockDispatch.dispatch.mock.calls.find((c) => c[1].id === 'sans')?.[0].key).toBe('high');
  });

  it('signale une date de démarrage absente (la suite ne cible alors personne)', async () => {
    startDate.value = null;
    const warn = vi.spyOn((cron as unknown as { logger: { warn: () => void } }).logger, 'warn');
    await cron.run();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ONBOARDING_SEQUENCE_START'));
  });
});
