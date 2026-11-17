import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AmbassadorService } from '../ambassador/ambassador.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * B9 et démo protégée (#1064) : la suppression admin acceptait le compte démo (une ligne
 * DeletedAccount comptée, la vitrine cassée jusqu'au re-seed) ; rôle, modale « Modifier » et
 * promotion ambassadeur le modifiaient aussi. Seul « Offrir Premium » le refusait déjà.
 */
const prisma = {
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  deletedAccount: { create: vi.fn() },
  $transaction: vi.fn(),
};
const ambassador = { promote: vi.fn(), revoke: vi.fn() };
const service = new UsersService(
  prisma as unknown as PrismaService,
  ambassador as unknown as AmbassadorService,
  { cancelAllSubscriptions: vi.fn() } as never,
);
const demo = { email: 'demo@mytradingcoach.app', role: 'USER', isDemo: true };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(demo);
});

describe('compte démo protégé des actions admin (B9 #1064)', () => {
  it('suppression refusée (409), rien d’archivé ni supprimé', async () => {
    await expect(service.adminDelete('demo')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('changement de rôle refusé (409)', async () => {
    await expect(service.setRole('demo', 'BETA_TESTER' as never)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.setRole('demo', 'AMBASSADOR' as never)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(ambassador.promote).not.toHaveBeenCalled();
  });

  it('modale « Modifier » refusée (409)', async () => {
    await expect(service.adminUpdate('demo', { isInternal: true })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('promotion ambassadeur par e-mail refusée (409)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'demo', name: 'Démo', referralCode: null, ...demo });
    const amb = new AmbassadorService(prisma as never);
    await expect(amb.promote(demo.email)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
