import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PublicService } from './public.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { ResendService } from '../resend/resend.service';

const mockPrisma = { user: { count: vi.fn() } };
const mockRedisService = {
  client: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
};
const mockResend = { sendAmbassadorApplication: vi.fn().mockResolvedValue(undefined) };

describe('PublicService', () => {
  let service: PublicService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ResendService, useValue: mockResend },
        { provide: ConfigService, useValue: { get: vi.fn(() => 'https://dev.app.mytradingcoach.app') } },
      ],
    }).compile();
    service = module.get(PublicService);
  });

  it('compte les inscrits réels en excluant démo et admin', async () => {
    mockRedisService.client.get.mockResolvedValueOnce(null);
    mockPrisma.user.count.mockResolvedValueOnce(14);

    const result = await service.getTradersCount();

    expect(result).toBe(14);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { isDemo: false, role: { not: Role.ADMIN } },
    });
    // Résultat mis en cache 10 min
    expect(mockRedisService.client.setex).toHaveBeenCalledWith('public:traders-count:dev.app.mytradingcoach.app', 600, '14');
  });

  it('sert depuis le cache Redis sans taper la BDD', async () => {
    mockRedisService.client.get.mockResolvedValueOnce('27');

    const result = await service.getTradersCount();

    expect(result).toBe(27);
    expect(mockRedisService.client.get).toHaveBeenCalledWith('public:traders-count:dev.app.mytradingcoach.app');
    expect(mockPrisma.user.count).not.toHaveBeenCalled();
  });

  it('fallback BDD si Redis est indisponible', async () => {
    mockRedisService.client.get.mockRejectedValueOnce(new Error('redis down'));
    mockPrisma.user.count.mockResolvedValueOnce(9);

    const result = await service.getTradersCount();

    expect(result).toBe(9);
  });

  describe('applyAmbassador (candidature landing)', () => {
    it('agrège audience + liens et envoie le mail de candidature', async () => {
      const res = await service.applyAmbassador({
        name: '  Val  ', email: 'val@test.com',
        communities: ['YouTube', 'Discord'], links: 'https://youtube.com/val', hasCompany: true,
      });
      expect(res).toEqual({ success: true });
      expect(mockResend.sendAmbassadorApplication).toHaveBeenCalledWith({
        name: 'Val',
        email: 'val@test.com',
        socials: 'YouTube, Discord · https://youtube.com/val',
        message: 'Société pour facturer : oui',
      });
    });

    it('sans société → message « non / à confirmer », socials fallback', async () => {
      await service.applyAmbassador({ name: 'Lea', email: 'lea@test.com' });
      const arg = mockResend.sendAmbassadorApplication.mock.calls[0][0];
      expect(arg.socials).toBe('(non renseigné)');
      expect(arg.message).toBe('Société pour facturer : non / à confirmer');
    });
  });
});
