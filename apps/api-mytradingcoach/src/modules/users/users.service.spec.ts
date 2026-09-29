import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { Goal, Market } from './dto/onboarding.dto';
import { AmbassadorService } from '../ambassador/ambassador.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';

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
  deletedAccount: {
    create: vi.fn().mockReturnValue({ __op: 'create' }),
  },
  $transaction: vi.fn().mockResolvedValue([{}, {}]),
};


const mockRedisService = {
  client: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
    keys: vi.fn().mockResolvedValue([]),
  },
};
describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        // setRole délègue à AmbassadorService pour garantir le referralCode
        // d'un AMBASSADOR ; non sollicité par ces tests.
        { provide: AmbassadorService, useValue: { promote: vi.fn(), revoke: vi.fn() } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('saveOnboardingProfile', () => {
    it('persiste market et goal SANS marquer onboardingCompleted', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        market: 'CRYPTO',
        goal: 'DISCIPLINE',
      });

      await service.saveOnboardingProfile('user-1', {
        market: Market.CRYPTO,
        goal: Goal.DISCIPLINE,
      });

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'user-1' });
      expect(call.data).toEqual(
        expect.objectContaining({ market: 'CRYPTO', goal: 'DISCIPLINE' }),
      );
      // Le flag ne doit PAS être posé à l'étape stratégie
      expect(call.data).not.toHaveProperty('onboardingCompleted');
    });

    it('accepte market et goal null (skip) sans toucher le flag', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        market: null,
        goal: null,
      });

      await service.saveOnboardingProfile('user-1', { market: null, goal: null });

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.data).toEqual(
        expect.objectContaining({ market: null, goal: null }),
      );
      expect(call.data).not.toHaveProperty('onboardingCompleted');
    });
  });

  describe('finishOnboarding', () => {
    it('met onboardingCompleted à true', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        onboardingCompleted: true,
      });

      const result = await service.finishOnboarding('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { onboardingCompleted: true },
        }),
      );
      expect(result.onboardingCompleted).toBe(true);
    });
  });

  describe('updatePreferences', () => {
    it('ignore une devise globale envoyée : ni currency ni taux écrits, aucun appel réseau', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, notificationsEmail: false });

      const result = await service.updatePreferences('user-1', {
        currency: 'EUR',
        notificationsEmail: false,
      });

      const call = mockPrisma.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'user-1' });
      expect(call.data).toEqual(expect.objectContaining({ notificationsEmail: false }));
      expect(call.data).not.toHaveProperty('currency');
      expect(call.data).not.toHaveProperty('currencyRate');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.notificationsEmail).toBe(false);

      vi.unstubAllGlobals();
    });

    it('met à jour debriefAutomatic seul', async () => {
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        debriefAutomatic: false,
      });

      await service.updatePreferences('user-1', { debriefAutomatic: false });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { debriefAutomatic: false } }),
      );
    });
  });

  describe('deleteMe', () => {
    it('supprime le compte utilisateur (avec trace DeletedAccount)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser, plan: 'FREE', referredBy: null, _count: { trades: 0 },
      });
      mockPrisma.user.delete.mockReturnValue({ __op: 'delete' });

      await service.deleteMe('user-1');

      expect(mockPrisma.deletedAccount.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
