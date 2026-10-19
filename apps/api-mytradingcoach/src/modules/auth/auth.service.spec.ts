import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { SetupsService } from '../setups/setups.service';
import { DemoSeedService } from '../admin/demo-seed.service';
import { ProductEventsService } from '../product-events/product-events.service';
import { AdminNotifier } from '../admin-push/admin-notifier.service';
import { GoogleIdTokenVerifier, GoogleTokenRefusedException } from './google-id-token.verifier';

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

const mockDemoSeed = { ensureFresh: vi.fn().mockResolvedValue(false) };
const mockProductEvents = { record: vi.fn().mockResolvedValue(undefined) };

const mockNotifier = { notify: vi.fn() };

const GOOGLE_IDENTITY = { googleId: 'g-sub-1', email: 'trader@gmail.com', name: 'Trader' };
const mockVerifier = { verify: vi.fn() };

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
        { provide: DemoSeedService, useValue: mockDemoSeed },
        { provide: ProductEventsService, useValue: mockProductEvents },
        { provide: AdminNotifier, useValue: mockNotifier },
        { provide: GoogleIdTokenVerifier, useValue: mockVerifier },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('demoLogin', () => {
    it('rafraîchit la démo si besoin AVANT de connecter le visiteur', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockSafeUser);
      const res = await service.demoLogin();
      expect(mockDemoSeed.ensureFresh).toHaveBeenCalledWith('connexion démo');
      expect(res.access_token).toBe('mock_token');
    });

    it('un re-seed en échec ne bloque pas la connexion démo', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockSafeUser);
      mockDemoSeed.ensureFresh.mockRejectedValueOnce(new Error('db lente'));
      await expect(service.demoLogin()).resolves.toMatchObject({ access_token: 'mock_token' });
    });

    it('compte la visite de la démo dans l’entonnoir', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...mockSafeUser, id: 'demo-id' });
      await service.demoLogin();
      expect(mockProductEvents.record).toHaveBeenCalledWith('demo-id', 'demo_open');
    });
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

    it('inscription → un push admin SIGNUP, sans e-mail dans le message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: mockUser.id, email: mockUser.email, name: 'Thomas', plan: 'FREE', role: 'USER', createdAt: mockUser.createdAt });

      await service.register({ email: 'test@test.com', password: 'password123', name: 'Thomas' });

      expect(mockNotifier.notify).toHaveBeenCalledOnce();
      const [event, message] = mockNotifier.notify.mock.calls[0];
      expect(event).toBe('SIGNUP');
      expect(message).toMatchObject({ title: 'Nouvelle inscription', url: '/users' });
      expect(JSON.stringify(message)).not.toContain('test@test.com');
    });

    it('compte ADMIN créé → pas de push', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: mockUser.id, email: mockUser.email, name: 'A', plan: 'FREE', role: 'ADMIN', createdAt: mockUser.createdAt });

      await service.register({ email: 'test@test.com', password: 'password123', name: 'A' });

      expect(mockNotifier.notify).not.toHaveBeenCalled();
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

  describe('googleAuth (#618)', () => {
    const dto = { credential: 'x'.repeat(40) };
    const env = { ...process.env };

    beforeEach(() => {
      process.env['FEATURE_GOOGLE_AUTH'] = 'true';
      process.env['GOOGLE_CLIENT_ID'] = 'mtc-test.apps.googleusercontent.com';
      mockVerifier.verify.mockResolvedValue(GOOGLE_IDENTITY);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ ...mockSafeUser, id: 'new-user', email: GOOGLE_IDENTITY.email, tokenVersion: 0 });
    });

    afterEach(() => {
      process.env = { ...env };
    });

    it('flag coupé → 404, le jeton n’est même pas vérifié', async () => {
      process.env['FEATURE_GOOGLE_AUTH'] = 'false';
      await expect(service.googleAuth(dto)).rejects.toThrow(NotFoundException);
      expect(mockVerifier.verify).not.toHaveBeenCalled();
    });

    it('vérifie le jeton contre le client ID de l’environnement', async () => {
      await service.googleAuth(dto);
      expect(mockVerifier.verify).toHaveBeenCalledWith(dto.credential, 'mtc-test.apps.googleusercontent.com');
    });

    it.each(['invalid_token', 'email_not_verified'] as const)('jeton refusé (%s) → aucun compte touché', async (reason) => {
      mockVerifier.verify.mockRejectedValue(new GoogleTokenRefusedException(reason));
      await expect(service.googleAuth(dto)).rejects.toThrow(GoogleTokenRefusedException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('googleId connu → connexion, sans création ni liaison', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123', email: 'test@test.com', role: 'USER', isDemo: false, tokenVersion: 2 });
      const res = await service.googleAuth(dto);
      expect(res.googleStatus).toBe('login');
      expect(res.access_token).toBe('mock_token');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      // Le refresh token porte la version courante des sessions.
      expect(mockJwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: 'user-123', tv: 2 }), expect.anything());
    });

    it('e-mail existant (casse différente) → liaison sur CE compte, jamais de doublon', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-123', email: 'Trader@Gmail.com', role: 'USER', isDemo: false,
        googleId: null, emailVerifiedAt: new Date('2026-01-01'), tokenVersion: 0,
      });
      mockPrisma.user.update.mockResolvedValue({ ...mockSafeUser, password: 'hash', googleId: 'g-sub-1', tokenVersion: 0 });

      const res = await service.googleAuth(dto);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: { equals: 'trader@gmail.com', mode: 'insensitive' } } }),
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      const { data } = mockPrisma.user.update.mock.calls[0][0];
      expect(data.googleId).toBe('g-sub-1');
      // Adresse déjà prouvée : le mot de passe est gardé.
      expect(data).not.toHaveProperty('password');
      expect(res).toMatchObject({ googleStatus: 'linked', passwordCleared: false });
      expect(res.user).toMatchObject({ hasPassword: true, googleLinked: true });
      expect(res.user).not.toHaveProperty('password');
      expect(res.user).not.toHaveProperty('googleId');
    });

    it('liaison sur un compte jamais vérifié → mot de passe retiré et sessions révoquées', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-123', email: 'trader@gmail.com', role: 'USER', isDemo: false,
        googleId: null, emailVerifiedAt: null, tokenVersion: 0,
      });
      mockPrisma.user.update.mockResolvedValue({ ...mockSafeUser, password: null, googleId: 'g-sub-1', tokenVersion: 1 });

      const res = await service.googleAuth(dto);

      const { data } = mockPrisma.user.update.mock.calls[0][0];
      expect(data).toMatchObject({
        password: null,
        resetPasswordToken: null,
        tokenVersion: { increment: 1 },
        emailVerifiedAt: expect.any(Date),
      });
      expect(res.passwordCleared).toBe(true);
      // Nouveau refresh token émis à la NOUVELLE version : les anciens ne passent plus.
      expect(mockJwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ tv: 1 }), expect.anything());
    });

    it('compte déjà relié à un AUTRE compte Google → 409, rien n’est écrasé', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-123', email: 'trader@gmail.com', role: 'USER', isDemo: false,
        googleId: 'autre-sub', emailVerifiedAt: new Date(), tokenVersion: 0,
      });
      await expect(service.googleAuth(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ['démo', { role: 'USER', isDemo: true }],
      ['ADMIN', { role: 'ADMIN', isDemo: false }],
    ])('compte %s → Google refusé (connexion comme liaison)', async (_label, flags) => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'a@b.c', tokenVersion: 0, ...flags });
      await expect(service.googleAuth(dto)).rejects.toThrow(ForbiddenException);

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u', email: 'a@b.c', googleId: null, emailVerifiedAt: null, tokenVersion: 0, ...flags });
      await expect(service.googleAuth(dto)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('nouvel e-mail → création avec parrain, UTM conservés, e-mail vérifié, sans mot de passe', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // googleId
        .mockResolvedValueOnce({ referralCode: 'VAL' }); // parrain
      const res = await service.googleAuth({
        ...dto,
        referralCode: 'val',
        acquisitionSource: 'instagram',
        acquisitionMedium: 'story',
        acquisitionCampaign: 'oct',
      });

      const { data } = mockPrisma.user.create.mock.calls[0][0];
      expect(data).toMatchObject({
        email: 'trader@gmail.com',
        password: null,
        name: 'Trader',
        referredBy: 'VAL',
        acquisitionSource: 'instagram',
        acquisitionMedium: 'story',
        acquisitionCampaign: 'oct',
        authProvider: 'GOOGLE',
        googleId: 'g-sub-1',
        emailVerifiedAt: expect.any(Date),
      });
      expect(res.googleStatus).toBe('created');
      // Mêmes effets qu'une inscription e-mail.
      expect(mockResend.sendWelcomeFree).toHaveBeenCalledTimes(1);
      expect(mockNotifier.notify).toHaveBeenCalledTimes(1);
    });

    it('inscription Google → opt-in marketing FAUX par défaut', async () => {
      await service.googleAuth(dto);
      const { data } = mockPrisma.user.create.mock.calls[0][0];
      expect(data.marketingConsent).toBe(false);
      expect(data.marketingConsentAt).toBeNull();
    });

    it('double clic : la 2de création échoue sur l’unicité → connexion au compte créé', async () => {
      mockPrisma.user.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test', meta: { target: ['googleId'] } }),
      );
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // 1er passage : googleId inconnu
        .mockResolvedValueOnce({ id: 'new-user', email: 'trader@gmail.com', role: 'USER', isDemo: false, tokenVersion: 0 });
      const res = await service.googleAuth(dto);
      expect(res.googleStatus).toBe('login');
    });
  });

  describe('login d’un compte Google sans mot de passe', () => {
    it('401 identique à un mauvais mot de passe, argon2 jamais appelé', async () => {
      const argon2 = await import('argon2');
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, password: null });
      await expect(service.login({ email: 'test@test.com', password: 'Password123' })).rejects.toThrow(
        new UnauthorizedException('Identifiants invalides'),
      );
      expect(argon2.verify).not.toHaveBeenCalled();
    });
  });

  describe('finalizeGoogleSignup', () => {
    it('enregistre le choix explicite et la date de finalisation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ authProvider: 'GOOGLE', signupFinalizedAt: null });
      await service.finalizeGoogleSignup('user-123', true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { signupFinalizedAt: expect.any(Date), marketingConsent: true, marketingConsentAt: expect.any(Date) },
        }),
      );
    });

    it('déjà finalisée → consentement non réécrit', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ authProvider: 'GOOGLE', signupFinalizedAt: new Date() })
        .mockResolvedValueOnce(mockSafeUser);
      await service.finalizeGoogleSignup('user-123', true);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('compte e-mail → 400', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ authProvider: 'EMAIL', signupFinalizedAt: null });
      await expect(service.finalizeGoogleSignup('user-123', false)).rejects.toThrow(BadRequestException);
    });
  });

  describe('unlinkGoogle', () => {
    it('refusé sans mot de passe défini (le compte deviendrait inaccessible)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ password: null, googleId: 'g-sub-1' });
      await expect(service.unlinkGoogle('user-123')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('avec mot de passe → googleId retiré', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ password: 'hash', googleId: 'g-sub-1' });
      await service.unlinkGoogle('user-123');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { googleId: null } }));
    });
  });

  describe('refresh : révocation par version', () => {
    it('refresh token d’une version périmée → 401', async () => {
      (mockJwt as Record<string, unknown>)['verifyAsync'] = vi.fn().mockResolvedValue({ sub: 'user-123', email: 'a@b.c', tv: 0 });
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockSafeUser, password: null, googleId: 'g', tokenVersion: 1 });
      await expect(service.refresh('t')).rejects.toThrow(UnauthorizedException);
    });

    it('refresh token d’avant #618 (sans version) = version 0 → accepté', async () => {
      (mockJwt as Record<string, unknown>)['verifyAsync'] = vi.fn().mockResolvedValue({ sub: 'user-123', email: 'a@b.c' });
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockSafeUser, password: 'h', googleId: null, tokenVersion: 0 });
      await expect(service.refresh('t')).resolves.toMatchObject({ access_token: 'mock_token' });
    });
  });

  describe('forgotPassword d’un compte Google sans mot de passe', () => {
    it('même traitement (204) mais e-mail « définir un mot de passe »', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, password: null });
      mockPrisma.user.update.mockResolvedValue(mockUser);
      await service.forgotPassword('test@test.com');
      expect(mockResend.sendResetPassword).toHaveBeenCalledWith(expect.objectContaining({ googleOnly: true }));
    });
  });
});
