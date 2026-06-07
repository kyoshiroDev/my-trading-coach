import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PublicService } from './public.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';

const mockPrisma = { user: { count: vi.fn() } };
const mockRedisService = {
  client: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  },
};

describe('PublicService', () => {
  let service: PublicService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedisService },
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
    expect(mockRedisService.client.setex).toHaveBeenCalledWith('public:traders-count', 600, '14');
  });

  it('sert depuis le cache Redis sans taper la BDD', async () => {
    mockRedisService.client.get.mockResolvedValueOnce('27');

    const result = await service.getTradersCount();

    expect(result).toBe(27);
    expect(mockPrisma.user.count).not.toHaveBeenCalled();
  });

  it('fallback BDD si Redis est indisponible', async () => {
    mockRedisService.client.get.mockRejectedValueOnce(new Error('redis down'));
    mockPrisma.user.count.mockResolvedValueOnce(9);

    const result = await service.getTradersCount();

    expect(result).toBe(9);
  });
});
