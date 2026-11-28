import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FounderAdminService } from './founder-admin.service';
import { freezeClock } from '../../test/freeze-clock';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FounderOfferService } from './founder-offer.service';

/**
 * A11 (#1065) : l'admin affichait l'offre fondateur « ouverte » (interrupteur) alors qu'elle ne vend
 * plus (date de fin passée ou 0 place). `ended` suit la même règle que la route publique.
 */
const NOW = new Date('2026-11-18T12:00:00.000Z');
const prisma = {
  founderSeat: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
};
const founders = { getConfig: vi.fn(), seatsLeft: vi.fn() };
const service = new FounderAdminService(prisma as unknown as PrismaService, founders as unknown as FounderOfferService);

freezeClock(NOW);
beforeEach(() => {
  vi.resetAllMocks();
  prisma.founderSeat.findMany.mockResolvedValue([]);
  prisma.founderSeat.count.mockResolvedValue(0);
  prisma.founderSeat.groupBy.mockResolvedValue([]);
});

describe('FounderAdminService.list — offre qui ne vend plus (A11 #1065)', () => {
  it.each([
    ['date de fin passée', { open: true, endsAt: new Date(NOW.getTime() - 1000) }, 50, true],
    ['plus aucune place', { open: true, endsAt: null }, 0, true],
    ['ouverte et en vente', { open: true, endsAt: new Date(NOW.getTime() + 86_400_000) }, 50, false],
    ['fermée à la main', { open: false, endsAt: null }, 50, false],
  ])('%s', async (_l, config, seatsLeft, ended) => {
    founders.getConfig.mockResolvedValue(config);
    founders.seatsLeft.mockResolvedValue(seatsLeft);
    const res = await service.list({ page: 1 });
    expect(res.offer.open).toBe(config.open);
    expect(res.offer.ended).toBe(ended);
  });
});

// #1156 : `FounderSeat.interval` est un String en base, le contrat admin dit 'month' | 'year'.
describe('FounderAdminService.list — période rétrécie au contrat (#1156)', () => {
  it.each([['year', 'year'], ['month', 'month'], ['week', 'month']])('%s → %s', async (stored, expected) => {
    founders.getConfig.mockResolvedValue({ open: true, endsAt: null });
    founders.seatsLeft.mockResolvedValue(10);
    prisma.founderSeat.findMany.mockResolvedValue([{
      number: 1, status: 'ACTIVE', interval: stored, cta: null, takenAt: NOW, endedAt: null, user: null,
    }]);
    const res = await service.list({ page: 1 });
    expect(res.rows[0].interval).toBe(expected);
  });
});
