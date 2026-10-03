import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { isOfferedPremium } from './premium-offer.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

const DAY = 86_400_000;
const NOW = new Date('2026-10-03T12:00:00.000Z');

const base = {
  plan: 'FREE', role: 'USER', isDemo: false, trialEndsAt: null as Date | null,
  stripeSubscriptionId: null as string | null, stripeSubscriptionStatus: null as string | null,
};

const prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
const cache = { invalidate: vi.fn() };
const service = new UsersService(
  prisma as unknown as PrismaService,
  {} as AmbassadorService,
  cache as never,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prisma.user.update.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('UsersService.offerPremium', () => {
  it('accorde 30 jours par défaut : trialEndsAt = now + 30 j, trialUsed, plan inchangé', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base });
    const res = await service.offerPremium('u1', undefined, 'admin-1');
    const expected = new Date(NOW.getTime() + 30 * DAY);
    expect(res).toEqual({ trialEndsAt: expected.toISOString() });
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ trialEndsAt: expected, trialUsed: true });
    expect(data).not.toHaveProperty('plan');
    expect(cache.invalidate).toHaveBeenCalledWith('u1');
  });

  it('prolonge à partir de la fin actuelle si un mois offert est en cours', async () => {
    const end = new Date(NOW.getTime() + 10 * DAY);
    prisma.user.findUnique.mockResolvedValue({ ...base, trialEndsAt: end });
    const res = await service.offerPremium('u1', 30);
    expect(res.trialEndsAt).toBe(new Date(end.getTime() + 30 * DAY).toISOString());
  });

  it('repart de maintenant si l’ancienne fin est passée', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base, trialEndsAt: new Date(NOW.getTime() - 5 * DAY) });
    const res = await service.offerPremium('u1', 7);
    expect(res.trialEndsAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
  });

  it('404 si l’utilisateur n’existe pas', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.offerPremium('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['abonnement Stripe actif', { stripeSubscriptionId: 'sub_1', stripeSubscriptionStatus: 'active' }, 'abonnement Stripe'],
    ['essai Stripe', { stripeSubscriptionId: 'sub_1', stripeSubscriptionStatus: 'trialing' }, 'abonnement Stripe'],
    ['plan PREMIUM', { plan: 'PREMIUM' }, 'déjà Premium'],
    ['ADMIN', { role: 'ADMIN' }, 'rôle'],
    ['BETA_TESTER', { role: 'BETA_TESTER' }, 'rôle'],
    ['compte démo', { isDemo: true }, 'démo'],
  ])('409 : %s', async (_label, patch, msg) => {
    prisma.user.findUnique.mockResolvedValue({ ...base, ...patch });
    const err = await service.offerPremium('u1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain(msg);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un abonnement Stripe résilié (canceled) n’empêche pas l’offre', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base, stripeSubscriptionId: 'sub_1', stripeSubscriptionStatus: 'canceled' });
    await expect(service.offerPremium('u1')).resolves.toHaveProperty('trialEndsAt');
  });
});

describe('isOfferedPremium', () => {
  const future = new Date(NOW.getTime() + DAY);
  it('vrai : fin future sans abonnement Stripe', () => {
    expect(isOfferedPremium({ trialEndsAt: future, stripeSubscriptionStatus: null }, NOW)).toBe(true);
  });
  it('faux : abonnement Stripe en cours, fin passée ou absente', () => {
    expect(isOfferedPremium({ trialEndsAt: future, stripeSubscriptionStatus: 'trialing' }, NOW)).toBe(false);
    expect(isOfferedPremium({ trialEndsAt: new Date(NOW.getTime() - DAY), stripeSubscriptionStatus: null }, NOW)).toBe(false);
    expect(isOfferedPremium({ trialEndsAt: null, stripeSubscriptionStatus: null }, NOW)).toBe(false);
  });
});
