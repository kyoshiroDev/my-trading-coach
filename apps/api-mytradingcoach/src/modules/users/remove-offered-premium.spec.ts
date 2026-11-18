import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { freezeClock } from '../../test/freeze-clock';
import { subscriptionStateWhere } from '../../common/stats/subscription-state-where';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

/**
 * B10 (#1064, décision du 16/11) : aucune route pour retirer un Premium offert par l'admin ; l'accès
 * continuait jusqu'à `trialEndsAt`. « Retirer le Premium offert » remet en gratuit tout de suite,
 * seulement pour un Premium offert depuis l'admin, jamais pour un abonnement Stripe.
 */
const DAY = 86_400_000;
const NOW = new Date('2026-11-17T12:00:00.000Z');
const prisma = { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } };
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

const offered = (over: object = {}) => ({
  isDemo: false, trialSource: 'ADMIN', trialEndsAt: new Date(NOW.getTime() + 20 * DAY),
  signupTrialEndsAt: null as Date | null, stripeSubscriptionStatus: null as string | null, ...over,
});

freezeClock(NOW);
beforeEach(() => {
  vi.resetAllMocks(); // vide aussi les files mockResolvedValueOnce d'un test interrompu
  prisma.user.update.mockResolvedValue({});
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  discord.setPlanRole.mockResolvedValue(undefined);
  redis.client.del.mockResolvedValue(1);
});

describe('UsersService.removeOfferedPremium (B10 #1064)', () => {
  it('Premium offert en cours : fin ramenée à maintenant, accès coupé tout de suite', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(offered())
      .mockResolvedValueOnce({ discordId: 'd-1', plan: 'FREE', role: 'USER', trialEndsAt: NOW });
    const res = await service.removeOfferedPremium('u1', 'admin-1');
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { trialEndsAt: NOW } }));
    expect(res).toEqual({ trialEndsAt: null });
    expect(cache.invalidate).toHaveBeenCalledWith('u1');
    expect(redis.client.del).toHaveBeenCalledWith('billing:status:u1');
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', false);
  });

  it('ancien Premium offert sans origine enregistrée (trialSource null) : retiré aussi', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(offered({ trialSource: null }))
      .mockResolvedValueOnce({ discordId: null, plan: 'FREE', role: 'USER', trialEndsAt: NOW });
    await expect(service.removeOfferedPremium('u1')).resolves.toEqual({ trialEndsAt: null });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { trialEndsAt: NOW } }));
  });

  it('offert pendant l’essai d’inscription encore en cours : l’essai d’inscription est rendu, pas coupé', async () => {
    const signupEnd = new Date(NOW.getTime() + 5 * DAY);
    prisma.user.findUnique
      .mockResolvedValueOnce(offered({ trialEndsAt: new Date(signupEnd.getTime() + 30 * DAY), signupTrialEndsAt: signupEnd }))
      .mockResolvedValueOnce({ discordId: null, plan: 'FREE', role: 'USER', trialEndsAt: signupEnd });
    const res = await service.removeOfferedPremium('u1');
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { trialEndsAt: signupEnd, trialSource: 'SIGNUP' },
    }));
    expect(res).toEqual({ trialEndsAt: signupEnd.toISOString() });
  });

  it('essai d’inscription déjà terminé : fin ramenée à maintenant, pas à l’ancienne fin d’essai', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(offered({ signupTrialEndsAt: new Date(NOW.getTime() - 3 * DAY) }))
      .mockResolvedValueOnce({ discordId: null, plan: 'FREE', role: 'USER', trialEndsAt: NOW });
    await expect(service.removeOfferedPremium('u1')).resolves.toEqual({ trialEndsAt: null });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { trialEndsAt: NOW } }));
  });

  // Relecteur (#1064) : un webhook Stripe qui arrive entre la lecture et l'écriture ne doit jamais
  // voir son abonnement écrasé. L'écriture refait les contrôles dans son where.
  it('écriture conditionnelle : l’état a changé depuis la lecture (count 0) → 409, rien réaligné', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(offered());
    prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.removeOfferedPremium('u1')).rejects.toThrow('Aucun Premium offert en cours.');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', ...subscriptionStateWhere('offered', NOW) },
      data: { trialEndsAt: NOW },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(redis.client.del).not.toHaveBeenCalled();
    expect(discord.setPlanRole).not.toHaveBeenCalled();
  });

  it.each([
    ['essai d’inscription seul', { trialSource: 'SIGNUP' }],
    ['offre déjà terminée', { trialEndsAt: new Date(NOW.getTime() - DAY) }],
    ['aucune offre', { trialSource: null, trialEndsAt: null }],
  ])('rien à retirer (%s) : 409, rien d’écrit', async (_l, over) => {
    prisma.user.findUnique.mockResolvedValueOnce(offered(over));
    await expect(service.removeOfferedPremium('u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid'])('abonnement Stripe (%s) : 409, jamais modifié à la main', async (status) => {
    prisma.user.findUnique.mockResolvedValueOnce(offered({ stripeSubscriptionStatus: status }));
    await expect(service.removeOfferedPremium('u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('compte démo : 409 ; inconnu : 404', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(offered({ isDemo: true }));
    await expect(service.removeOfferedPremium('u1')).rejects.toThrow('Compte démo');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.removeOfferedPremium('u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
