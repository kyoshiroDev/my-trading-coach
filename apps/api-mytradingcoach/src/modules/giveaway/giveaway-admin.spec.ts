import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GiveawayActivation, GiveawayPool } from '@prisma/client';
import { GiveawayAdminService } from './giveaway-admin.service';
import { freezeClock } from '../../test/freeze-clock';

const prisma = {
  giveawayWin: { findUnique: vi.fn(), updateMany: vi.fn() },
  giveawayDraw: { findMany: vi.fn(async () => []) },
};
const settings = {
  get: vi.fn(async () => ({ freeEnabled: false, premiumEnabled: false, freeEnabledAt: null, premiumEnabledAt: null, freeAnnouncedAt: null, premiumAnnouncedAt: null })),
  manualDrawAvailable: vi.fn(() => false),
  activationAvailable: vi.fn(() => false),
  announceAudienceCount: vi.fn(async () => 7),
};
const eligibility = { eligibleIds: vi.fn(async () => ['a', 'b']) };
const draws = { draw: vi.fn() };
const prizes = { apply: vi.fn() };
const redis = { client: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } };
const service = new GiveawayAdminService(prisma as never, settings as never, eligibility as never, draws as never, prizes as never, redis as never);

freezeClock('2027-02-10T10:00:00Z');
beforeEach(() => {
  vi.clearAllMocks();
  redis.client.get.mockResolvedValue(null);
});

describe('GiveawayAdminService', () => {
  it('relance : seulement un lot en échec', async () => {
    prisma.giveawayWin.findUnique.mockResolvedValueOnce({ activationStatus: GiveawayActivation.APPLIED });
    await expect(service.retry('w1')).rejects.toBeInstanceOf(ConflictException);
    expect(prizes.apply).not.toHaveBeenCalled();

    prisma.giveawayWin.findUnique.mockResolvedValueOnce({ activationStatus: GiveawayActivation.FAILED });
    await service.retry('w1');
    expect(prizes.apply).toHaveBeenCalledWith('w1');
  });

  it('relance d’un lot inconnu → 404', async () => {
    prisma.giveawayWin.findUnique.mockResolvedValueOnce(null);
    await expect(service.retry('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('« Tirer maintenant » refusé en prod (403), rien n’est tiré', async () => {
    await expect(service.drawNow(GiveawayPool.FREE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(draws.draw).not.toHaveBeenCalled();
  });

  it('modération d’un lot inconnu → 404', async () => {
    prisma.giveawayWin.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.moderate('x', 'VALIDE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('modération : renvoie la ligne à jour', async () => {
    prisma.giveawayWin.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await service.moderate('w1', 'VALIDE')).toBeNull(); // aucune ligne dans l'historique simulé
    expect(prisma.giveawayWin.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'w1' }, data: { moderation: 'VALIDE' } });
  });

  it('éligibles affichés : calculés une fois puis lus dans le cache', async () => {
    const d = await service.data();
    expect(d.free.eligibleNow).toBe(2);
    expect(d.free.announceAudience).toBe(7);
    expect(d.activationAvailable).toBe(false);
    expect(redis.client.set).toHaveBeenCalledWith('giveaway:eligible-now:FREE', '2', 'EX', 900);
    redis.client.get.mockResolvedValue('5' as never);
    eligibility.eligibleIds.mockClear();
    expect((await service.data()).premium.eligibleNow).toBe(5);
    expect(eligibility.eligibleIds).not.toHaveBeenCalled();
  });
});
