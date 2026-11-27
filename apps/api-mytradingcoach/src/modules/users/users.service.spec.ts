import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PREFERENCE_FIELDS } from './preference-fields';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { StripeAccountClosureService } from '../stripe/stripe-account-closure.service';
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
  giveawayWin: { updateMany: vi.fn() },
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
        { provide: StripeAccountClosureService, useValue: { cancelAllSubscriptions: vi.fn() } },
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

  describe('updatePreferences : liste blanche (#1267)', () => {
    it('un champ hors liste n’est jamais écrit, même s’il passait la validation', async () => {
      mockPrisma.user.update.mockResolvedValue(mockUser);
      const dto = { notificationsEmail: true, plan: 'PREMIUM', role: 'ADMIN', isDemo: false, email: 'x@example.com' };
      await service.updatePreferences('user-1', dto as unknown as UpdatePreferencesDto);
      expect(mockPrisma.user.update.mock.calls.at(-1)![0].data).toEqual({ notificationsEmail: true });
    });

    it('chaque champ autorisé est recopié tel quel, aucun autre', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ marketingConsent: true });
      mockPrisma.user.update.mockResolvedValue(mockUser);
      const dto: UpdatePreferencesDto = {
        startingCapital: 50_000,
        notificationsEmail: false,
        debriefAutomatic: true,
        marketingConsent: true,
        tradingStyle: 'scalping',
        tradingStrategy: ['breakout'],
        tradingSessions: ['NEW_YORK'],
        tradesPerDayMin: 1,
        tradesPerDayMax: 5,
        strategyDescription: 'ORB 5 min',
        newsShieldMinutes: 10,
      };
      await service.updatePreferences('user-1', dto);
      expect(Object.keys(dto).sort()).toEqual([...PREFERENCE_FIELDS].sort());
      expect(mockPrisma.user.update.mock.calls.at(-1)![0].data).toEqual(dto);
    });
  });

  describe('updatePreferences : consentement e-mails', () => {
    const save = async (current: boolean, next: boolean) => {
      mockPrisma.user.findUnique.mockResolvedValue({ marketingConsent: current });
      mockPrisma.user.update.mockResolvedValue(mockUser);
      await service.updatePreferences('user-1', { marketingConsent: next });
      return mockPrisma.user.update.mock.calls.at(-1)![0].data;
    };

    it('l’activer horodate le consentement et rétablit les conseils de prise en main', async () => {
      expect(await save(false, true)).toEqual({
        marketingConsent: true,
        marketingConsentAt: expect.any(Date),
        marketingConsentWithdrawnAt: null,
        serviceEmailsOptOutAt: null,
      });
    });

    it('le couper arrête aussi les conseils et date le retrait, sans effacer la date du consentement (#747)', async () => {
      expect(await save(true, false)).toEqual({
        marketingConsent: false,
        marketingConsentWithdrawnAt: expect.any(Date),
        serviceEmailsOptOutAt: expect.any(Date),
      });
    });

    it('valeur inchangée (le profil la renvoie à chaque enregistrement) : ni horodatage ni conseils touchés', async () => {
      expect(await save(true, true)).toEqual({ marketingConsent: true });
      expect(await save(false, false)).toEqual({ marketingConsent: false });
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

    // #994 (N17) : le corps n'est pas validé ; un `reason` non textuel faisait planter `.trim()`
    // et la suppression échouait (500). Raison ignorée, compte supprimé.
    it('raison qui n’est pas du texte → ignorée, suppression faite', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser, plan: 'FREE', referredBy: null, _count: { trades: 0 },
      });
      mockPrisma.user.delete.mockReturnValue({ __op: 'delete' });

      await service.deleteMe('user-1', 42 as unknown as string);

      expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.reason).toBeNull();
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });
});
