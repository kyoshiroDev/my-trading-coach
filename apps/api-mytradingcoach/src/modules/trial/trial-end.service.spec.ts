import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrialEndService } from './trial-end.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DiscordService } from '../discord/discord.service';

const NOW = new Date('2026-11-16T23:30:00.000Z');
const TRIAL_ENDS_AT_REF = { name: 'trialEndsAt', modelName: 'User' };

const prisma = {
  user: { findMany: vi.fn(), updateMany: vi.fn(), fields: { trialEndsAt: TRIAL_ENDS_AT_REF } },
};
const discord = { syncDiscordRole: vi.fn() };
const service = new TrialEndService(prisma as unknown as PrismaService, discord as unknown as DiscordService);

beforeEach(() => {
  vi.clearAllMocks();
  discord.syncDiscordRole.mockResolvedValue(undefined);
  prisma.user.updateMany.mockImplementation(({ where }) => Promise.resolve({ count: where.id.in.length }));
});

describe('TrialEndService.handleEndedTrials (#769)', () => {
  it('cible les fins passées non traitées (ou repoussées depuis), hors démo', async () => {
    prisma.user.findMany.mockResolvedValueOnce([]);
    await service.handleEndedTrials(NOW);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      isDemo: false,
      trialEndsAt: { lte: NOW },
      OR: [{ trialEndHandledAt: null }, { trialEndHandledAt: { lt: TRIAL_ENDS_AT_REF } }],
    });
  });

  it('réaligne Discord puis marque la fin traitée', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }]);
    const res = await service.handleEndedTrials(NOW);
    expect(discord.syncDiscordRole.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2']);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'u2'] } },
      data: { trialEndHandledAt: NOW },
    });
    expect(res).toEqual({ handled: 2, discordFailed: 0 });
  });

  it('un échec Discord n’empêche pas le traitement, il est seulement compté', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u1' }]);
    discord.syncDiscordRole.mockRejectedValueOnce(new Error('discord down'));
    expect(await service.handleEndedTrials(NOW)).toEqual({ handled: 1, discordFailed: 1 });
  });

  it('journal du cron : comptes seulement, jamais d’identifiant', async () => {
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'user-secret-id' }]);
    const log = vi.spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);
    await service.handleDaily();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('user-secret-id');
  });
});
