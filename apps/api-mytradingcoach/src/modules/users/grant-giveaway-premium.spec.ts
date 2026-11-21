import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';
import { UsersService } from './users.service';
import { PREMIUM_OFFERABLE_WHERE, premiumOfferRefusal, type PremiumOfferCandidate } from './premium-offer.util';
import { matchWhere } from '../../test/prisma-where';
import { freezeClock } from '../../test/freeze-clock';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

const DAY = 86_400_000;
const NOW = new Date('2027-02-01T08:00:00.000Z');

const prisma = { user: { findUnique: vi.fn(), updateMany: vi.fn() } };
const cache = { invalidate: vi.fn() };
const discord = { setPlanRole: vi.fn() };
const redis = { client: { del: vi.fn() } };
const service = new UsersService(
  prisma as unknown as PrismaService,
  {} as AmbassadorService,
  {} as never,
  cache as never,
  discord as never,
  redis as never,
);

const base = {
  plan: Plan.FREE, role: Role.USER, isDemo: false, trialEndsAt: null as Date | null, discordId: null as string | null,
  stripeSubscriptionId: null as string | null, stripeSubscriptionStatus: null as string | null,
};

freezeClock(NOW);
beforeEach(() => {
  vi.resetAllMocks();
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  discord.setPlanRole.mockResolvedValue(undefined);
  redis.client.del.mockResolvedValue(1);
});

describe('UsersService.grantGiveawayPremium (lot du tirage gratuit)', () => {
  it('compte gratuit : 1 mois civil à partir de maintenant, origine GIVEAWAY, plan inchangé', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base });
    const res = await service.grantGiveawayPremium('u1', 1, NOW);
    expect(res).toEqual({ startsAt: NOW, endsAt: new Date('2027-03-01T08:00:00.000Z') });
    const call = prisma.user.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ trialEndsAt: res.endsAt, trialUsed: true, trialSource: 'GIVEAWAY' });
    expect(call.where).toMatchObject({ id: 'u1' });
    expect(cache.invalidate).toHaveBeenCalledWith('u1');
    expect(redis.client.del).toHaveBeenCalledWith('billing:status:u1');
  });

  it('pendant un essai en cours : le mois gagné s’ajoute après la fin de l’essai', async () => {
    const trialEnd = new Date(NOW.getTime() + 5 * DAY);
    prisma.user.findUnique.mockResolvedValue({ ...base, trialEndsAt: trialEnd });
    const res = await service.grantGiveawayPremium('u1', 1, NOW);
    expect(res.startsAt).toEqual(trialEnd);
    expect(res.endsAt).toEqual(new Date('2027-03-06T08:00:00.000Z'));
  });

  it('31 janvier + 1 mois → 28 février (jour plafonné)', async () => {
    const jan31 = new Date('2027-01-31T10:00:00.000Z');
    prisma.user.findUnique.mockResolvedValue({ ...base });
    const res = await service.grantGiveawayPremium('u1', 1, jan31);
    expect(res.endsAt).toEqual(new Date('2027-02-28T10:00:00.000Z'));
  });

  it('abonnement pris entre-temps → refusé, rien d’écrit', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base, stripeSubscriptionId: 'sub', stripeSubscriptionStatus: 'active' });
    await expect(service.grantGiveawayPremium('u1', 1, NOW)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('écriture conditionnelle refusée (course avec un webhook) → conflit', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.grantGiveawayPremium('u1', 1, NOW)).rejects.toBeInstanceOf(ConflictException);
  });

  it('Discord lié : rôle Premium posé', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...base, discordId: 'd-1' });
    await service.grantGiveawayPremium('u1', 1, NOW);
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', true);
  });
});

describe('premiumOfferRefusal ≡ PREMIUM_OFFERABLE_WHERE (une seule règle)', () => {
  const statuses = [null, 'active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete'];
  const cases: PremiumOfferCandidate[] = [];
  for (const plan of [Plan.FREE, Plan.PREMIUM])
    for (const role of [Role.USER, Role.ADMIN, Role.BETA_TESTER, Role.AMBASSADOR])
      for (const isDemo of [false, true])
        for (const stripeSubscriptionId of [null, 'sub_1'])
          for (const stripeSubscriptionStatus of statuses)
            cases.push({ plan, role, isDemo, stripeSubscriptionId, stripeSubscriptionStatus });

  it(`même verdict sur ${cases.length} combinaisons`, () => {
    for (const c of cases) {
      expect(matchWhere(c as never, PREMIUM_OFFERABLE_WHERE as never), JSON.stringify(c)).toBe(premiumOfferRefusal(c) === null);
    }
  });
});
