import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockUser = {
  id: 'user-1',
  email: 'trader@test.com',
  name: 'Greg',
  plan: 'FREE',
  trialEndsAt: null,
  trialUsed: false,
  onboardingCompleted: false,
  market: null,
  goal: null,
  currency: 'USD',
  notificationsEmail: true,
  debriefAutomatic: true,
  createdAt: new Date(),
};

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  trade: {
    count: vi.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('completeOnboarding', () => {
    it('met onboardingCompleted à true avec market et goal', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingCompleted: true,
        market: 'CRYPTO',
        goal: 'DISCIPLINE',
      });

      const result = await service.completeOnboarding('user-1', {
        market: 'CRYPTO',
        goal: 'DISCIPLINE',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ onboardingCompleted: true, market: 'CRYPTO', goal: 'DISCIPLINE' }),
        }),
      );
      expect(result.onboardingCompleted).toBe(true);
    });

    it('accepte market et goal null (skip)', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingCompleted: true,
        market: null,
        goal: null,
      });

      await service.completeOnboarding('user-1', { market: null, goal: null });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ onboardingCompleted: true, market: null, goal: null }),
        }),
      );
    });
  });

  describe('updatePreferences', () => {
    it('met à jour currency et notificationsEmail', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        currency: 'EUR',
        notificationsEmail: false,
      });

      const result = await service.updatePreferences('user-1', {
        currency: 'EUR',
        notificationsEmail: false,
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { currency: 'EUR', notificationsEmail: false },
        }),
      );
      expect(result.currency).toBe('EUR');
      expect(result.notificationsEmail).toBe(false);
    });

    it('met à jour debriefAutomatic seul', async () => {
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, debriefAutomatic: false });

      await service.updatePreferences('user-1', { debriefAutomatic: false });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { debriefAutomatic: false } }),
      );
    });
  });

  describe('deleteMe', () => {
    it('supprime le compte utilisateur', async () => {
      mockPrisma.user.delete.mockResolvedValue(mockUser);

      await service.deleteMe('user-1');

      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });
});
