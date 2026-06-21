import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DebriefService } from './debrief.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SessionService } from '../session/session.service';

const mockDebrief = {
  id: 'debrief-1',
  userId: 'user-123',
  weekNumber: 15,
  year: 2026,
  startDate: new Date('2026-04-07'),
  endDate: new Date('2026-04-13'),
  aiSummary: 'Bonne semaine.',
  insights: {
    summary: 'Bonne semaine.',
    strengths: [],
    weaknesses: [],
    objectives: [],
  },
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
  tradingAccount: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  user: { findUnique: vi.fn().mockResolvedValue(null) },
};

const mockAiService = {
  generateDebrief: vi.fn().mockResolvedValue({
    overview: { summary: 'Bonne semaine.' },
    accounts: [],
    objectives: [],
  }),
  checkDailyLimit: vi.fn().mockResolvedValue(undefined),
};

const mockAnalyticsService = {
  getSummary: vi
    .fn()
    .mockResolvedValue({ winRate: 60, totalPnl: 250, totalTrades: 5 }),
};

const mockSessionService = {
  getSessionHistory: vi.fn().mockResolvedValue([]),
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
        { provide: SessionService, useValue: mockSessionService },
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

    it('retourne le débrief le plus récent en fallback si aucun pour la semaine courante', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(mockDebrief);

      const result = await service.getCurrent('user-123');

      expect(result).toEqual(mockDebrief);
      expect(mockPrisma.weeklyDebrief.findFirst).toHaveBeenCalledOnce();
    });

    it('retourne null si aucun débrief disponible', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);

      const result = await service.getCurrent('user-123');

      expect(result).toBeNull();
    });
  });

  describe('getByWeek', () => {
    it("retourne le débrief d'une semaine spécifique", async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);

      const result = await service.getByWeek('user-123', 2026, 15);

      expect(result).toEqual(mockDebrief);
    });

    it('lance NotFoundException si le débrief est introuvable', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);

      await expect(service.getByWeek('user-123', 2026, 99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getHistory', () => {
    it("retourne l'historique des débriefs (max 52 semaines)", async () => {
      mockPrisma.weeklyDebrief.findMany.mockResolvedValue([mockDebrief]);

      const result = await service.getHistory('user-123');

      expect(result).toHaveLength(1);
      expect(mockPrisma.weeklyDebrief.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 52 }),
      );
    });
  });

  describe('generate', () => {
    it("génère un débrief en appelant l'IA et le persiste", async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      const result = await service.generate('user-123');

      expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
      expect(mockPrisma.weeklyDebrief.upsert).toHaveBeenCalledOnce();
      expect(result).toEqual(mockDebrief);
    });

    it('par compte : UN SEUL appel IA, stats backend + analyse IA fusionnées', async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockImplementation((args: { create: unknown }) =>
        Promise.resolve(args.create),
      );
      mockPrisma.tradingAccount.findMany.mockResolvedValue([
        { id: 'acc-perso', label: 'Compte principal', type: 'PERSONAL', status: 'ACTIVE', startingBalance: 0, profitTarget: null, maxDrawdown: null, drawdownType: null },
        { id: 'acc-eval', label: 'Lucide 50k', type: 'EVALUATION', status: 'ACTIVE', startingBalance: 50000, profitTarget: 3000, maxDrawdown: 2500, drawdownType: 'TRAILING' },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { asset: 'BTC', side: 'LONG', pnl: 100, emotion: 'NEUTRAL', setup: 'BREAKOUT', session: 'NEW_YORK', tradedAt: new Date(), accountId: 'acc-perso' },
        { asset: 'ETH', side: 'SHORT', pnl: -40, emotion: 'NEUTRAL', setup: 'RANGE', session: 'LONDON', tradedAt: new Date(), accountId: 'acc-perso' },
      ]);
      mockAiService.generateDebrief.mockResolvedValueOnce({
        overview: { summary: 'Vue cross-compte.' },
        accounts: [
          { accountId: 'acc-perso', summary: 'Bon compte.', strengths: [{ badge: 'Force', text: 'risque constant' }], weaknesses: [], objectives: [{ title: 'o', reason: 'r' }], propNote: null },
          { accountId: 'acc-eval', summary: 'Éval à lancer.', strengths: [], weaknesses: [], objectives: [], propNote: 'Marge estimée OK (estimation depuis tes trades loggés, pas le calcul officiel de la firme)' },
        ],
        objectives: [{ title: 'Max 5 trades', reason: 'overtrading', check: { type: 'max_trades', params: { limit: 5 } } }],
      });

      await service.generate('user-123');

      // UN SEUL appel IA quel que soit le nombre de comptes.
      expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
      const aiArg = mockAiService.generateDebrief.mock.calls[0][0] as {
        accounts: unknown[]; tradesByAccount: Record<string, unknown[]>;
      };
      expect(aiArg.accounts).toHaveLength(2);
      expect(aiArg.tradesByAccount['acc-perso']).toHaveLength(2);

      const stored = (mockPrisma.weeklyDebrief.upsert.mock.calls[0][0] as { create: { insights: {
        overview: { summary: string };
        accounts: { accountId: string; stats: { totalTrades: number; winRate: number; totalPnl: number }; rules: { maxDrawdown: number | null } | null; propNote: string | null }[];
      } } }).create.insights;
      expect(stored.overview.summary).toBe('Vue cross-compte.');
      expect(stored.accounts).toHaveLength(2);
      const perso = stored.accounts.find((a) => a.accountId === 'acc-perso')!;
      expect(perso.stats).toEqual({ totalTrades: 2, winRate: 50, totalPnl: 60 });
      const evalAcc = stored.accounts.find((a) => a.accountId === 'acc-eval')!;
      expect(evalAcc.rules?.maxDrawdown).toBe(2500);
      expect(evalAcc.propNote).toContain('estimation');
    });
  });

  describe('normalizeObjectives', () => {
    type Svc = {
      normalizeObjectives: (o: unknown) => { title: string; reason: string; check: unknown }[];
      logger: { warn: (m: string) => void };
    };

    it('conserve un check valide du catalogue', () => {
      const svc = service as unknown as Svc;
      const out = svc.normalizeObjectives([
        { title: 'Max 3 trades', reason: 'overtrading', check: { type: 'max_trades', params: { limit: 3 } } },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].check).toEqual({ type: 'max_trades', params: { limit: 3 } });
    });

    it('neutralise un check hors catalogue (check:null) et loggue un warning', () => {
      const svc = service as unknown as Svc;
      const warn = vi.spyOn(svc.logger, 'warn').mockImplementation(() => undefined);
      const out = svc.normalizeObjectives([
        { title: 'Partager avec un mentor', reason: 'x', check: { type: 'share_mentor', params: {} } },
      ]);
      expect(out[0].check).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
    });

    it('objectif sans check → null sans warning (rétro-compat)', () => {
      const svc = service as unknown as Svc;
      const warn = vi.spyOn(svc.logger, 'warn').mockImplementation(() => undefined);
      const out = svc.normalizeObjectives([{ title: 'Ancien objectif', reason: 'x' }]);
      expect(out[0].check).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('renvoie [] si objectives absent', () => {
      const svc = service as unknown as Svc;
      expect(svc.normalizeObjectives(undefined)).toEqual([]);
    });
  });
});
