import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@api/prisma/prisma.service';
import { EmailDispatchService } from '../email-dispatch.service';

// Registre mocké : 2 campagnes automatisées ciblant le même user.
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
  return { CAMPAIGNS: [make('low', 50), make('high', 100)] };
});

import { AutoCampaignsCron } from './auto-campaigns.cron';

const mockPrisma = { user: { findMany: vi.fn() } };
const mockDispatch = {
  canSend: vi.fn().mockResolvedValue(true),
  dispatch: vi.fn().mockResolvedValue(true),
};

describe('AutoCampaignsCron', () => {
  let cron: AutoCampaignsCron;
  let nodeEnv = 'production';

  beforeEach(async () => {
    vi.clearAllMocks();
    nodeEnv = 'production';
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@test.com', name: 'Alice', marketingConsent: true, unsubToken: 't' },
    ]);

    const module = await Test.createTestingModule({
      providers: [
        AutoCampaignsCron,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailDispatchService, useValue: mockDispatch },
        { provide: ConfigService, useValue: { get: vi.fn((k: string) => (k === 'NODE_ENV' ? nodeEnv : undefined)) } },
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
});
