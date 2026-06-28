import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SetupsService } from './setups.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  setup: {
    count: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 6 }),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  trade: {
    count: vi.fn(),
  },
};

describe('SetupsService', () => {
  let service: SetupsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SetupsService);
  });

  describe('seedDefaults', () => {
    it('seede les 6 défauts si aucun setup', async () => {
      mockPrisma.setup.count.mockResolvedValue(0);
      const seeded = await service.seedDefaults('user-1');
      expect(seeded).toBe(true);
      expect(mockPrisma.setup.createMany).toHaveBeenCalledOnce();
      expect(mockPrisma.setup.createMany.mock.calls[0][0].data).toHaveLength(6);
    });

    it('ne seede pas si le user a déjà des setups (idempotent)', async () => {
      mockPrisma.setup.count.mockResolvedValue(6);
      const seeded = await service.seedDefaults('user-1');
      expect(seeded).toBe(false);
      expect(mockPrisma.setup.createMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('assigne sortOrder = max + 1', async () => {
      mockPrisma.setup.aggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
      mockPrisma.setup.create.mockResolvedValue({ id: 's1' });
      await service.create('user-1', { title: 'ORB', color: '#22d3ee', description: 'Opening range' });
      expect(mockPrisma.setup.create.mock.calls[0][0].data.sortOrder).toBe(5);
    });

    it('sortOrder = 0 si aucun setup existant', async () => {
      mockPrisma.setup.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      mockPrisma.setup.create.mockResolvedValue({ id: 's1' });
      await service.create('user-1', { title: 'ORB', color: '#22d3ee' });
      expect(mockPrisma.setup.create.mock.calls[0][0].data.sortOrder).toBe(0);
    });
  });

  describe('remove', () => {
    it('refuse la suppression si le setup a des trades', async () => {
      mockPrisma.setup.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.trade.count.mockResolvedValue(3);
      await expect(service.remove('user-1', 's1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.setup.delete).not.toHaveBeenCalled();
    });

    it('supprime si 0 trade', async () => {
      mockPrisma.setup.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.setup.delete.mockResolvedValue({ id: 's1' });
      await expect(service.remove('user-1', 's1')).resolves.toEqual({ deleted: true });
    });

    it('404 si le setup n’appartient pas au user', async () => {
      mockPrisma.setup.findFirst.mockResolvedValue(null);
      await expect(service.remove('user-1', 's1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertOwnedActive', () => {
    it('passe si le setup est actif et possédé', async () => {
      mockPrisma.setup.findFirst.mockResolvedValue({ id: 's1' });
      await expect(service.assertOwnedActive('user-1', 's1')).resolves.toBeUndefined();
    });

    it('400 si setup inconnu/archivé/hors compte', async () => {
      mockPrisma.setup.findFirst.mockResolvedValue(null);
      await expect(service.assertOwnedActive('user-1', 's1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('mappe le nombre de trades depuis _count', async () => {
      mockPrisma.setup.findMany.mockResolvedValue([
        { id: 's1', title: 'Breakout', color: '#10b981', description: null, sortOrder: 0, archived: false, _count: { trades: 12 } },
      ]);
      const result = await service.list('user-1');
      expect(result[0].tradeCount).toBe(12);
      expect(result[0].title).toBe('Breakout');
    });
  });
});
