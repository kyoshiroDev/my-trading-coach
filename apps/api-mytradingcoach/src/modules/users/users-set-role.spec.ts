/**
 * l'édition de rôle admin doit préserver l'invariant
 * « un AMBASSADOR a toujours un referralCode ».
 *
 * Avant : `setRole` écrivait le rôle en direct, donc un utilisateur promu par ce
 * chemin se retrouvait ambassadeur sans code (cas VAL) → lien `?ref=` cassé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { StripeAccountClosureService } from '../stripe/stripe-account-closure.service';
import { AmbassadorService } from '../ambassador/ambassador.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';

describe('UsersService.setRole — invariant code ambassadeur', () => {
  let service: UsersService;
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
  let ambassador: { promote: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    prisma = { user: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) } };
    ambassador = {
      promote: vi.fn().mockResolvedValue({ referralCode: 'VAL' }),
      revoke: vi.fn().mockResolvedValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: StripeAccountClosureService, useValue: { cancelAllSubscriptions: vi.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { client: {} } },
        { provide: AmbassadorService, useValue: ambassador },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('S6 (#1063) : cible ADMIN → 403, rien n’est écrit (un admin ne rétrograde pas un admin, ni lui-même)', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@x.com', role: 'ADMIN' });

    await expect(service.setRole('a1', 'USER' as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setRole('a1', 'BETA_TESTER' as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(ambassador.revoke).not.toHaveBeenCalled();
  });

  it('S6 (#1063) : « retirer bêta » sur un AMBASSADOR → 409, son code n’est pas retiré', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'amb@x.com', role: 'AMBASSADOR' });

    await expect(service.removeBetaRole('u2')).rejects.toBeInstanceOf(ConflictException);
    expect(ambassador.revoke).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('S6 (#1063) : « retirer bêta » sur un BETA_TESTER → USER', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'b@x.com', role: 'BETA_TESTER' });

    await service.removeBetaRole('u3');

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u3' }, data: { role: 'USER' } });
  });

  it('promotion en AMBASSADOR → passe par promote() (donc génère le code)', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'val@x.com', role: 'USER' });

    await service.setRole('u1', 'AMBASSADOR' as never);

    expect(ambassador.promote).toHaveBeenCalledWith('val@x.com');
    // Surtout pas d'écriture directe du rôle : elle laisserait le code à null.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rétrogradation depuis AMBASSADOR → passe par revoke() (vide le code)', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'val@x.com', role: 'AMBASSADOR' });

    await service.setRole('u1', 'USER' as never);

    expect(ambassador.revoke).toHaveBeenCalledWith('val@x.com');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('AMBASSADOR → BETA_TESTER : revoke puis application du rôle cible', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'val@x.com', role: 'AMBASSADOR' });

    await service.setRole('u1', 'BETA_TESTER' as never);

    expect(ambassador.revoke).toHaveBeenCalledWith('val@x.com');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'BETA_TESTER' } }),
    );
  });

  it('changement de rôle sans ambassadeur impliqué → écriture directe', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'k@x.com', role: 'USER' });

    await service.setRole('u1', 'BETA_TESTER' as never);

    expect(ambassador.promote).not.toHaveBeenCalled();
    expect(ambassador.revoke).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'BETA_TESTER' } }),
    );
  });

  it('ADMIN reste interdit via l\'API', async () => {
    await expect(service.setRole('u1', 'ADMIN' as never)).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('utilisateur inconnu → NotFound', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.setRole('nope', 'USER' as never)).rejects.toThrow(NotFoundException);
  });
});