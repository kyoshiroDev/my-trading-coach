import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

// Mock argon2 globally for all tests
vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('hashed_password'),
  verify: vi.fn().mockResolvedValue(true),
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

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

const mockJwt = {
  signAsync: vi.fn().mockResolvedValue('mock_token'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
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

      const result = await service.register({ email: 'test@test.com', password: 'password123', name: 'Thomas' });

      expect(result.user.plan).toBe('FREE');
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
    });

    it('lance ConflictException si email déjà utilisé', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(service.register({ email: 'test@test.com', password: 'password123' }))
        .rejects.toThrow(ConflictException);
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

      const result = await service.register({ email: 'test@test.com', password: 'password123' });

      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('login', () => {
    it('retourne les tokens et l\'utilisateur si identifiants corrects', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({ email: 'test@test.com', password: 'password123' });

      expect(result.access_token).toBeDefined();
      expect(result.user.email).toBe('test@test.com');
    });

    it('lance UnauthorizedException si email introuvable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login({ email: 'unknown@test.com', password: 'password123' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('ne retourne jamais le hash du mot de passe', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({ email: 'test@test.com', password: 'password123' });

      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('startTrial', () => {
    it('active le trial pour exactement 7 jours', async () => {
      const now = Date.now();
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, trialUsed: false });
      mockPrisma.user.update.mockImplementation(({ data }) => ({
        ...mockUser,
        ...data,
      }));

      const result = await service.startTrial('user-123');

      const trialMs = new Date(result.trialEndsAt!).getTime() - now;
      const trialDays = trialMs / (1000 * 60 * 60 * 24);

      expect(trialDays).toBeCloseTo(7, 0);
      expect(result.trialUsed).toBe(true);
    });

    it('lance BadRequestException si trial déjà utilisé', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, trialUsed: true });

      await expect(service.startTrial('user-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('lance UnauthorizedException si user introuvable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.startTrial('unknown-id'))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
