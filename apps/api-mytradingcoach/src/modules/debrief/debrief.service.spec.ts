import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DebriefService } from './debrief.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AnalyticsService } from '../analytics/analytics.service';

const mockDebrief = {
  id: 'debrief-1',
  userId: 'user-123',
  weekNumber: 15,
  year: 2026,
  startDate: new Date('2026-04-07'),
  endDate: new Date('2026-04-13'),
  aiSummary: 'Bonne semaine.',
  insights: { summary: 'Bonne semaine.', strengths: [], weaknesses: [], objectives: [] },
  objectives: [],
  stats: { winRate: 60, totalPnl: 250, totalTrades: 5 },
  generatedAt: new Date(),
};

const mockPrisma = {
  weeklyDebrief: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  trade: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

const mockAiService = {
  generateDebrief: vi.fn().mockResolvedValue({
    summary: 'Bonne semaine.',
    strengths: [],
    weaknesses: [],
    objectives: [],
  }),
  checkDailyLimit: vi.fn().mockResolvedValue(undefined),
};

const mockAnalyticsService = {
  getSummary: vi.fn().mockResolvedValue({ winRate: 60, totalPnl: 250, totalTrades: 5 }),
};

describe('DebriefService', () => {
  let service: DebriefService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebriefService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAiService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile();

    service = module.get<DebriefService>(DebriefService);
  });

  describe('getCurrent', () => {
    it('retourne le débrief de la semaine courante', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);

      const result = await service.getCurrent('user-123');

      expect(result).toEqual(mockDebrief);
      expect(mockPrisma.weeklyDebrief.findUnique).toHaveBeenCalledOnce();
    });

    it('retourne null si aucun débrief pour la semaine courante', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);

      const result = await service.getCurrent('user-123');

      expect(result).toBeNull();
    });
  });

  describe('getByWeek', () => {
    it('retourne le débrief d\'une semaine spécifique', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);

      const result = await service.getByWeek('user-123', 2026, 15);

      expect(result).toEqual(mockDebrief);
    });

    it('lance NotFoundException si le débrief est introuvable', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);

      await expect(service.getByWeek('user-123', 2026, 99))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('retourne l\'historique des débriefs (max 52 semaines)', async () => {
      mockPrisma.weeklyDebrief.findMany.mockResolvedValue([mockDebrief]);

      const result = await service.getHistory('user-123');

      expect(result).toHaveLength(1);
      expect(mockPrisma.weeklyDebrief.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 52 }),
      );
    });
  });

  describe('generate', () => {
    it('génère un débrief en appelant l\'IA et le persiste', async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      const result = await service.generate('user-123');

      expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
      expect(mockPrisma.weeklyDebrief.upsert).toHaveBeenCalledOnce();
      expect(result).toEqual(mockDebrief);
    });
  });
});
