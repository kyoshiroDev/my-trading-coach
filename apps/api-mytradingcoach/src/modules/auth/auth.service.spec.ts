import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { SetupsService } from '../setups/setups.service';

// Mock argon2 globally for all tests
vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn().mockResolvedValue('hashed_password'),
  verify: vi.fn().mockResolvedValue(true),
  needsRehash: vi.fn().mockReturnValue(false),
}));

const mockUser = {
  id: 'user-123',
  email: 'test@test.com',
  name: 'Thomas',
  password: 'hashed_password',
  plan: 'FREE',
  trialUsed: false,
  trialEndsAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Utilisateur renvoyé par getMe/login/register (ME_SELECT) — sans password
const mockSafeUser = {
  id: 'user-123',
  email: 'test@test.com',
  name: 'Thomas',
  plan: 'FREE',
  role: 'USER',
  onboardingCompleted: false,
  trialEndsAt: null,
  trialUsed: false,
  tradingStyle: null,
  tradingStrategy: [],
  tradingAssets: [],
  favoriteAsset: null,
};

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

const mockJwt = {
  signAsync: vi.fn().mockResolvedValue('mock_token'),
};

const mockResend = {
  sendWelcomeFree: vi.fn().mockResolvedValue(undefined),
  sendResetPassword: vi.fn().mockResolvedValue(undefined),
  sendAdminAlert: vi.fn().mockResolvedValue(undefined),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    // login/register renvoient désormais l'utilisateur issu d'un update(select: ME_SELECT).
    // Les tests startTrial/forgotPassword/resetPassword surchargent ce mock au besoin.
    mockPrisma.user.update.mockResolvedValue(mockSafeUser);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ResendService, useValue: mockResend },
        { provide: SetupsService, useValue: { seedDefaults: vi.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('crée un utilisateur avec plan FREE par défaut', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        plan: 'FREE',
        createdAt: mockUser.createdAt,
      });

      const result = await service.register({
        email: 'test@test.com',
        password: 'password123',
        name: 'Thomas',
      });

      expect(result.user.plan).toBe('FREE');
      expect(result.access_token).toBeDefined();
      // refresh_token géré par cookie httpOnly dans le controller — service retourne les deux tokens
      expect(result.refresh_token).toBeDefined();
    });

    it('une inscription = un seul e-mail (bienvenue), plus d’alerte admin par inscription', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: mockUser.id, email: mockUser.email, name: 'Thomas', plan: 'FREE', createdAt: mockUser.createdAt });

      await service.register({ email: 'test@test.com', password: 'password123', name: 'Thomas' });

      expect(mockResend.sendWelcomeFree).toHaveBeenCalledTimes(1);
      expect(mockResend.sendAdminAlert).not.toHaveBeenCalled();
    });

    it('persiste les UTM d’acquisition, et null quand ils sont absents', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: mockUser.id, email: mockUser.email, name: null, plan: 'FREE', createdAt: mockUser.createdAt });

      await service.register({
        email: 'test@test.com',
        password: 'password123',
        acquisitionSource: 'ninjatrader',
        acquisitionMedium: 'listing',
        acquisitionCampaign: 'ecosystem',
      });
      expect(mockPrisma.user.create.mock.calls[0][0].data).toMatchObject({
        acquisitionSource: 'ninjatrader',
        acquisitionMedium: 'listing',
        acquisitionCampaign: 'ecosystem',
      });

      await service.register({ email: 'other@test.com', password: 'password123' });
      // Jamais de valeur par défaut type « direct » : la distinction se fait à l'agrégation.
      expect(mockPrisma.user.create.mock.calls[1][0].data).toMatchObject({
        acquisitionSource: null,
        acquisitionMedium: null,
        acquisitionCampaign: null,
      });
    });

    it('lance ConflictException si email déjà utilisé', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({ email: 'test@test.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('ne retourne jamais le hash du mot de passe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        plan: 'FREE',
        createdAt: mockUser.createdAt,
      });

      const result = await service.register({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('login', () => {
    it("retourne les tokens et l'utilisateur si identifiants corrects", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result.access_token).toBeDefined();
      expect(result.user.email).toBe('test@test.com');
    });

    it('hash aux anciens paramètres : remplacé dans la même écriture que lastLoginAt', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      const argon2 = await import('argon2');
      vi.mocked(argon2.needsRehash).mockReturnValueOnce(true);
      vi.mocked(argon2.hash).mockResolvedValueOnce('nouveau_hash');

      await service.login({ email: 'test@test.com', password: 'password123' });

      expect(argon2.hash).toHaveBeenCalledWith('password123', expect.objectContaining({ memoryCost: 19_456 }));
      const data = mockPrisma.user.update.mock.calls.at(-1)![0].data;
      expect(data).toMatchObject({ password: 'nouveau_hash' });
      expect(data.lastLoginAt).toBeInstanceOf(Date);
    });

    it('hash déjà aux bons paramètres : le mot de passe n’est pas réécrit', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await service.login({ email: 'test@test.com', password: 'password123' });

      expect(mockPrisma.user.update.mock.calls.at(-1)![0].data).not.toHaveProperty('password');
    });

    it('lance UnauthorizedException si email introuvable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lance UnauthorizedException si mot de passe incorrect', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      const argon2 = await import('argon2');
      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('ne retourne jamais le hash du mot de passe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result.user).not.toHaveProperty('password');
    });
  });


  describe('forgotPassword', () => {
    it("ne fait rien si l'email n'existe pas (anti-énumération)", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword('unknown@test.com'),
      ).resolves.toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockResend.sendResetPassword).not.toHaveBeenCalled();
    });

    it("stocke un token hashé SHA256 et envoie l'email", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      await service.forgotPassword('test@test.com');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        }),
      );
      // Le token stocké est un hash (64 hex chars), pas le token brut
      const stored = mockPrisma.user.update.mock.calls[0][0].data
        .resetPasswordToken as string;
      expect(stored).toHaveLength(64);
      expect(mockResend.sendResetPassword).toHaveBeenCalledWith(
        expect.objectContaining({ to: mockUser.email }),
      );
    });

    it("l'expiration est dans ~1 heure", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const before = Date.now();
      await service.forgotPassword('test@test.com');
      const after = Date.now();

      const expires: Date =
        mockPrisma.user.update.mock.calls[0][0].data.resetPasswordExpires;
      const diffMs = expires.getTime() - before;
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - (after - before));
      expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
    });
  });

  describe('resetPassword', () => {
    it('lance BadRequestException si token invalide ou expiré', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword('invalid-token', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('met à jour le mot de passe et efface le token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      await service.resetPassword('valid-raw-token', 'newpassword123');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockUser.id },
          data: expect.objectContaining({
            password: 'hashed_password',
            resetPasswordToken: null,
            resetPasswordExpires: null,
          }),
        }),
      );
    });

    it('cherche par le hash SHA256 du token brut, pas le token brut', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const rawToken = 'my-raw-token';
      await service.resetPassword(rawToken, 'newpassword123');

      const query = mockPrisma.user.findFirst.mock.calls[0][0];
      // Le token passé à prisma ne doit pas être le token brut
      expect(query.where.resetPasswordToken).not.toBe(rawToken);
      // Doit être une string hexadécimale de 64 chars (SHA256)
      expect(query.where.resetPasswordToken).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
