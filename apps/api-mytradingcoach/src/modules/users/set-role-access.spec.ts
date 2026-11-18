import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AmbassadorService } from '../ambassador/ambassador.service';

/**
 * A2 = B3 (#1064) : passer un compte bêta-testeur (Premium par le rôle) ou le lui retirer laissait
 * le statut de facturation en cache 5 min et le rôle Discord inchangé (offerPremium le fait déjà).
 */
const prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
const ambassador = { promote: vi.fn(), revoke: vi.fn() };
const cache = { invalidate: vi.fn() };
const discord = { setPlanRole: vi.fn() };
const redis = { client: { del: vi.fn() } };
const service = new UsersService(
  prisma as unknown as PrismaService,
  ambassador as unknown as AmbassadorService,
  {} as never,
  cache as never,
  discord as never,
  redis as never,
);

const target = (role: string) => ({ email: 'b@x.com', role, isDemo: false });
const after = (role: string, discordId: string | null = 'd-1') =>
  ({ discordId, plan: 'FREE', role, trialEndsAt: null });

beforeEach(() => {
  vi.resetAllMocks(); // vide aussi les files mockResolvedValueOnce d'un test interrompu
  prisma.user.update.mockResolvedValue({});
  discord.setPlanRole.mockResolvedValue(undefined);
  redis.client.del.mockResolvedValue(1);
});

describe('UsersService.setRole — accès Premium réaligné (A2/B3 #1064)', () => {
  it('USER → BETA_TESTER : cache de facturation vidé, rôle Discord Premium posé', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(target('USER')).mockResolvedValueOnce(after('BETA_TESTER'));
    await service.setRole('u1', 'BETA_TESTER' as never);
    expect(redis.client.del).toHaveBeenCalledWith('billing:status:u1');
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', true);
  });

  it('BETA_TESTER → USER (retirer bêta) : rôle Discord Premium retiré', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ role: 'BETA_TESTER' }) // removeBetaRole
      .mockResolvedValueOnce(target('BETA_TESTER'))
      .mockResolvedValueOnce(after('USER'));
    await service.removeBetaRole('u1');
    expect(redis.client.del).toHaveBeenCalledWith('billing:status:u1');
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', false);
  });

  it('promotion ambassadeur : réalignée aussi (un ex-bêta peut y perdre le Premium)', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(target('USER')).mockResolvedValueOnce(after('AMBASSADOR'));
    await service.setRole('u1', 'AMBASSADOR' as never);
    expect(ambassador.promote).toHaveBeenCalledWith('b@x.com');
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', false);
  });

  it('AMBASSADOR → USER (revoke) : réalignée aussi', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(target('AMBASSADOR')).mockResolvedValueOnce(after('USER'));
    await service.setRole('u1', 'USER' as never);
    expect(ambassador.revoke).toHaveBeenCalledWith('b@x.com');
    expect(redis.client.del).toHaveBeenCalledWith('billing:status:u1');
    expect(discord.setPlanRole).toHaveBeenCalledWith('d-1', false);
  });

  it('sans Discord lié : aucun appel ; Discord ou Redis en panne : le rôle est quand même changé', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(target('USER')).mockResolvedValueOnce(after('BETA_TESTER', null));
    await service.setRole('u1', 'BETA_TESTER' as never);
    expect(discord.setPlanRole).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValueOnce(target('USER')).mockResolvedValueOnce(after('BETA_TESTER'));
    discord.setPlanRole.mockRejectedValueOnce(new Error('discord down'));
    redis.client.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.setRole('u1', 'BETA_TESTER' as never)).resolves.toBeUndefined();
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { role: 'BETA_TESTER' } });
  });
});
