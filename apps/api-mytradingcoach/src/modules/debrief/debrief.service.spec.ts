import { inactiveAccountsTradeWhere } from '../accounts/account-status-scope';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { freezeClock } from '../../test/freeze-clock';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
  generatedAt: new Date('2026-06-01T10:00:00Z'), // date fixe : C1 compare au seuil du dimanche,
};

const mockPrisma = {
  weeklyDebrief: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  trade: {
    // Une semaine tradée par défaut (C8 : sans trade, generate répond 400).
    findMany: vi.fn().mockResolvedValue([
      { asset: 'NQ', side: 'LONG', pnl: 100, commission: 2, emotion: null, tradeSession: null, setup: null, session: null, tradedAt: new Date('2026-11-10T15:00:00Z'), accountId: null },
    ]),
  },
  tradingAccount: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  user: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
};

const mockAiService = {
  generateDebrief: vi.fn().mockResolvedValue({
    overview: { summary: 'Bonne semaine.' },
    accounts: [],
    objectives: [],
  }),
  checkDailyLimit: vi.fn().mockResolvedValue(undefined),
  releaseDailyLimit: vi.fn().mockResolvedValue(undefined),
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
  // Dates en dur (semaine du 09/11/2026, getCurrent sur la semaine courante) : horloge figée (règle 1 de tests).
  freezeClock('2026-11-12T12:00:00Z');
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

  describe('getPDFData : trades clôturés seulement (C13 #1046, convention #947)', () => {
    it('semaine perdante avec une position ouverte : meilleur trade = la plus petite perte, ouvert hors du compte', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValueOnce({
        ...mockDebrief,
        startDate: new Date('2026-11-09T00:00:00'),
        endDate: new Date('2026-11-15T23:59:59.999'),
        insights: null,
        objectives: [],
      });
      const rows = [
        { asset: 'NQ', side: 'LONG', pnl: -10, commission: 0, riskReward: null, tradedAt: new Date('2026-11-10T15:00:00Z') },
        { asset: 'NQ', side: 'SHORT', pnl: -40, commission: 0, riskReward: null, tradedAt: new Date('2026-11-11T15:00:00Z') },
        { asset: 'ES', side: 'LONG', pnl: null, commission: null, riskReward: null, tradedAt: new Date('2026-11-12T15:00:00Z') },
      ];
      // La base applique le filtre : une position ouverte (pnl null) n'est renvoyée que s'il manque.
      mockPrisma.trade.findMany.mockImplementationOnce(async (args: { where: { pnl?: unknown } }) =>
        args.where.pnl ? rows.filter((r) => r.pnl !== null) : rows,
      );

      const data = await service.getPDFData('user-123', 2026, 46);

      expect(data.stats.totalTrades).toBe(2);
      expect(data.stats.bestTrade).toBe(-10);
      expect(data.stats.worstTrade).toBe(-40);
      expect(data.stats.totalPnl).toBe(-50);
      expect(data.topTrades.map((t) => t.pnl)).toEqual([-10, -40]);
    });
  });

  describe('generate', () => {
    it('C13 (#1046) : position ouverte hors des stats par compte et des trades envoyés à l’IA', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockImplementation((args: { create: unknown }) => Promise.resolve(args.create));
      mockPrisma.tradingAccount.findMany.mockResolvedValueOnce([
        { id: 'acc-perso', label: 'Perso', type: 'PERSONAL', status: 'ACTIVE', startingBalance: 0, profitTarget: null, maxDrawdown: null, drawdownType: null },
      ]);
      mockPrisma.trade.findMany.mockResolvedValueOnce([
        { asset: 'NQ', side: 'LONG', pnl: 80, commission: 0, emotion: null, setup: null, session: null, tradedAt: new Date(), accountId: 'acc-perso' },
        { asset: 'ES', side: 'LONG', pnl: null, commission: null, emotion: null, setup: null, session: null, tradedAt: new Date(), accountId: 'acc-perso' },
      ]);

      await service.generate('user-123', Role.USER, true);

      const aiArg = mockAiService.generateDebrief.mock.calls[0][0] as {
        trades: unknown[]; accounts: { tradesCount: number }[]; tradesByAccount: Record<string, unknown[]>;
      };
      expect(aiArg.trades).toHaveLength(1);
      expect(aiArg.accounts[0].tradesCount).toBe(1);
      expect(aiArg.tradesByAccount['compte-1']).toHaveLength(1);
      const stored = (mockPrisma.weeklyDebrief.upsert.mock.calls[0][0] as { create: { insights: {
        accounts: { stats: { totalTrades: number } }[];
      } } }).create.insights;
      expect(stored.accounts[0].stats.totalTrades).toBe(1);
    });

    describe('stat « Tes trades autour des annonces » (#670)', () => {
      // Dates fixes : horloge figée (règle du dépôt). Annonce forte le mardi 10/11/2026 à 16:00 Paris
      // (15:00 UTC, heure d'hiver), pile à l'heure du trade NQ par défaut.
      freezeClock('2026-11-11T15:00:00Z');
      const prisma = mockPrisma as unknown as { ecoEvent?: { findMany: ReturnType<typeof vi.fn> } };
      const REF = { refDate: new Date('2026-11-11T15:00:00') };
      const prepare = (newsShieldMinutes: number | null) => {
        mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
        mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);
        mockPrisma.user.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
          args.select && 'newsShieldMinutes' in args.select ? { newsShieldMinutes } : null);
        prisma.ecoEvent = { findMany: vi.fn().mockResolvedValue([{ date: '2026-11-10', time: '16:00', name: 'CPI YoY (Oct)', nameFr: null, currency: 'USD' }]) };
      };
      afterEach(() => {
        delete prisma.ecoEvent;
        mockPrisma.user.findUnique.mockReset().mockResolvedValue(null);
      });
      const saved = () => mockPrisma.weeklyDebrief.upsert.mock.calls[0][0] as { create: { stats: Record<string, unknown> }; update: { stats: Record<string, unknown> } };

      it('annonce forte dans la semaine : stat écrite en création et en mise à jour, jamais envoyée à l’IA', async () => {
        prepare(null);
        await service.generate('user-123', Role.USER, true, REF);
        const expected = { windowMinutes: 5, inside: { count: 1, pnl: 98, winRate: 100 }, outside: { count: 0, pnl: 0, winRate: 0 } };
        expect(saved().create.stats['newsWindow']).toEqual(expected);
        expect(saved().update.stats['newsWindow']).toEqual(expected);
        expect((mockAiService.generateDebrief.mock.calls[0][0] as { stats: object }).stats).not.toHaveProperty('newsWindow');
        expect(prisma.ecoEvent!.findMany.mock.calls[0][0].where).toMatchObject({ impact: 'high' });
      });

      it('bouclier coupé (0) : la stat prend quand même la fenêtre par défaut (constat, pas une alerte)', async () => {
        prepare(0);
        await service.generate('user-123', Role.USER, true, REF);
        expect(saved().create.stats['newsWindow']).toMatchObject({ windowMinutes: 5 });
      });

      it('lecture des annonces en échec : débrief généré sans la stat, nom de l’erreur seulement', async () => {
        prepare(null);
        prisma.ecoEvent!.findMany.mockRejectedValueOnce(new TypeError('base user-123'));
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        await service.generate('user-123', Role.USER, true, REF);
        expect(saved().create.stats).not.toHaveProperty('newsWindow');
        expect(warn.mock.calls.map((c) => String(c[0]))).toContain('Stat « autour des annonces » non calculée : TypeError');
        warn.mockRestore();
      });
    });

    it("génère un débrief en appelant l'IA et le persiste", async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      const result = await service.generate('user-123');

      expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
      expect(mockPrisma.weeklyDebrief.upsert).toHaveBeenCalledOnce();
      expect(result.debrief).toEqual(mockDebrief);
      expect(result.created).toBe(true);
    });

    it("stats du résumé : l'id du compte du pire drawdown ne part ni à l'IA ni en base", async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);
      mockAnalyticsService.getSummary.mockResolvedValueOnce({ winRate: 60, totalPnl: 250, totalTrades: 5, maxDrawdown: 400, maxDrawdownAccountId: 'acc-b' });

      await service.generate('user-123');

      const sent = (mockAiService.generateDebrief.mock.calls[0][0] as { stats: object }).stats;
      const upsert = mockPrisma.weeklyDebrief.upsert.mock.calls[0][0] as { create: { stats: object }; update: { stats: object } };
      for (const stats of [sent, upsert.create.stats, upsert.update.stats]) {
        expect(stats).toEqual({ winRate: 60, totalPnl: 250, totalTrades: 5, maxDrawdown: 400 });
      }
    });

    it('stats du résumé limitées à la semaine du débrief, du lundi 00:00 au dimanche 23:59:59.999 (#934)', async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      await service.generate('user-123', Role.USER, true, { refDate: new Date('2026-11-11T15:00:00') });
      expect(mockAnalyticsService.getSummary).toHaveBeenLastCalledWith(
        'user-123',
        undefined,
        new Date('2026-11-09T00:00:00.000'),
        new Date('2026-11-15T23:59:59.999'),
      );

      // Semaine passée : les bornes suivent refDate (jamais tout l'historique).
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      await service.generate('user-123', Role.USER, true, { refDate: new Date('2026-06-24T12:00:00') });
      expect(mockAnalyticsService.getSummary).toHaveBeenLastCalledWith(
        'user-123',
        undefined,
        new Date('2026-06-22T00:00:00.000'),
        new Date('2026-06-28T23:59:59.999'),
      );
    });

    it('C2 (#1045) : l’IA échoue → la génération du jour est rendue, on peut réessayer', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockAiService.generateDebrief.mockRejectedValueOnce(new Error('IA surchargée'));

      await expect(service.generate('user-123', Role.USER, false, { force: true })).rejects.toThrow('IA surchargée');

      expect(mockAiService.checkDailyLimit).toHaveBeenCalledWith('user-123', 'debrief', 1);
      expect(mockAiService.releaseDailyLimit).toHaveBeenCalledWith('user-123', 'debrief');
      expect(mockPrisma.weeklyDebrief.upsert).not.toHaveBeenCalled();
    });

    it('C2 (#1045) : génération sans limite (cron, admin) qui échoue → rien à rendre', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockAiService.generateDebrief.mockRejectedValueOnce(new Error('IA surchargée'));

      await expect(service.generate('user-123', Role.USER, true)).rejects.toThrow('IA surchargée');

      expect(mockAiService.releaseDailyLimit).not.toHaveBeenCalled();
    });

    it('C5 (#1046) : objectifs = débrief strictement AVANT la semaine visée, à cheval sur l’année', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      // Semaine ISO 1 de 2027 (lundi 4 janvier) : la semaine 53 de 2026 doit pouvoir servir.
      await service.generate('user-123', Role.USER, true, { refDate: new Date('2027-01-06T12:00:00'), force: true });

      expect(mockPrisma.weeklyDebrief.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-123', OR: [{ year: { lt: 2027 } }, { year: 2027, weekNumber: { lt: 1 } }] },
        orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
      });
    });

    it('C5 (#1046) : séances récentes bornées à la fin de la semaine visée', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      await service.generate('user-123', Role.USER, true, { refDate: new Date('2026-06-24T12:00:00') });

      expect(mockSessionService.getSessionHistory).toHaveBeenCalledWith(
        'user-123', 5, 0, { before: new Date('2026-06-28T23:59:59.999') },
      );
    });

    const NO_CLOSED_TRADE =
      'Aucun trade clôturé cette semaine pour l’instant. Le débrief se génère dès ton premier trade clôturé de la semaine.';

    it('C8 (#1046) : aucun trade dans la semaine → 400 clair, ni IA, ni limite du jour, ni débrief vide', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValueOnce([]);

      await expect(service.generate('user-123', Role.USER, false, { force: true })).rejects.toMatchObject({
        status: 400,
        message: NO_CLOSED_TRADE,
      });
      expect(mockAiService.checkDailyLimit).not.toHaveBeenCalled();
      expect(mockAiService.generateDebrief).not.toHaveBeenCalled();
      expect(mockPrisma.weeklyDebrief.upsert).not.toHaveBeenCalled();
    });

    it('#1056 : seulement des positions ouvertes dans la semaine → 400, aucun appel IA payé pour un débrief vide', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValueOnce([
        { asset: 'NQ', side: 'LONG', pnl: null, commission: null, emotion: null, tradeSession: null, setup: null, session: null, tradedAt: new Date('2026-11-10T15:00:00Z'), accountId: null },
        { asset: 'ES', side: 'SHORT', pnl: null, commission: null, emotion: null, tradeSession: null, setup: null, session: null, tradedAt: new Date('2026-11-11T15:00:00Z'), accountId: 'acc-perso' },
      ]);

      await expect(service.generate('user-123', Role.USER, false, { force: true })).rejects.toMatchObject({
        status: 400,
        message: NO_CLOSED_TRADE,
      });
      expect(mockAiService.checkDailyLimit).not.toHaveBeenCalled();
      expect(mockAiService.generateDebrief).not.toHaveBeenCalled();
      expect(mockPrisma.weeklyDebrief.upsert).not.toHaveBeenCalled();
    });

    it('#1056 : un trade clôturé à l’équilibre (P&L 0) compte comme clôturé → débrief généré', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);
      mockPrisma.trade.findMany.mockResolvedValueOnce([
        { asset: 'NQ', side: 'LONG', pnl: 0, commission: 0, emotion: null, tradeSession: null, setup: null, session: null, tradedAt: new Date('2026-11-10T15:00:00Z'), accountId: null },
      ]);

      await service.generate('user-123', Role.USER, true, { force: true });

      expect(mockAiService.generateDebrief).toHaveBeenCalledTimes(1);
    });

    describe('C1 (#1048) : débrief manuel de milieu de semaine refait le dimanche soir', () => {
      // Semaine 46 de 2026 : lundi 9 → dimanche 15 novembre ; seuil = dimanche 15, 23:00 à Paris (22:00 UTC).
      const sunday = new Date('2026-11-15T22:00:00Z');

      describe('cron du dimanche, 23:00:02 à Paris', () => {
        freezeClock('2026-11-15T22:00:02Z');
        it('débrief généré mercredi → régénéré sur la semaine complète (e-mail)', async () => {
          mockPrisma.weeklyDebrief.findUnique.mockResolvedValue({ ...mockDebrief, generatedAt: new Date('2026-11-11T09:00:00Z') });
          mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
          mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

          // refDate dans la semaine 46 pour tout fuseau du runner (la semaine se calcule en heure locale).
          const result = await service.generateForUser('user-123', { refDate: new Date('2026-11-13T12:00:00Z'), force: false });

          expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
          expect(result.created).toBe(true);
        });
      });

      describe('rattrapage du lundi, 08:00 à Paris', () => {
        freezeClock('2026-11-16T07:00:00Z');
        it('anti double e-mail : débrief produit par le cron du dimanche → rien de refait', async () => {
          mockPrisma.weeklyDebrief.findUnique.mockResolvedValue({ ...mockDebrief, generatedAt: new Date('2026-11-15T22:00:40Z') });

          const result = await service.generateForUser('user-123', { refDate: new Date('2026-11-09T07:00:00Z'), force: false });

          expect(result).toEqual({ debrief: expect.anything(), created: false });
          expect(mockAiService.generateDebrief).not.toHaveBeenCalled();
        });
      });

      describe('mercredi 18:00, avant le seuil', () => {
        freezeClock('2026-11-11T17:00:00Z');
        it('autre appel sans force : le débrief du jour reste tel quel', async () => {
          mockPrisma.weeklyDebrief.findUnique.mockResolvedValue({ ...mockDebrief, generatedAt: new Date('2026-11-11T09:00:00Z') });

          const result = await service.generateForUser('user-123', { force: false });

          expect(result.created).toBe(false);
          expect(mockAiService.generateDebrief).not.toHaveBeenCalled();
        });
      });

      it('weeklyCutoff : dimanche 23:00 à Paris de la semaine visée, été comme hiver', () => {
        expect(service.weeklyCutoff(new Date('2026-11-11T10:00:00'))).toEqual(sunday);
        expect(service.weeklyCutoff(new Date('2026-07-01T10:00:00'))).toEqual(new Date('2026-07-05T21:00:00Z'));
      });
    });

    it('idempotent : débrief existant + pas de force → retourne l\'existant, zéro IA, zéro upsert', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);

      const result = await service.generate('user-123');

      expect(result).toEqual({ debrief: mockDebrief, created: false });
      expect(mockAiService.generateDebrief).not.toHaveBeenCalled();
      expect(mockPrisma.weeklyDebrief.upsert).not.toHaveBeenCalled();
    });

    it('force=true : régénère même si existant (IA + upsert), created=true', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(mockDebrief);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockResolvedValue(mockDebrief);

      const result = await service.generate('user-123', Role.USER, true, { force: true });

      expect(mockAiService.generateDebrief).toHaveBeenCalledOnce();
      expect(mockPrisma.weeklyDebrief.upsert).toHaveBeenCalledOnce();
      expect(result.created).toBe(true);
    });

    it('refDate dans une semaine passée → cible (year, weekNumber) de cette semaine ISO', async () => {
      mockPrisma.weeklyDebrief.findUnique.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockImplementation((args: { create: unknown }) =>
        Promise.resolve(args.create),
      );

      // Mercredi 24 juin 2026 = semaine ISO 26.
      await service.generate('user-123', Role.USER, true, { refDate: new Date('2026-06-24T12:00:00') });

      const createArg = (mockPrisma.weeklyDebrief.upsert.mock.calls[0][0] as {
        create: { weekNumber: number; year: number };
      }).create;
      expect(createArg.weekNumber).toBe(26);
      expect(createArg.year).toBe(2026);
      // L'idempotence a bien cherché la semaine ciblée.
      expect(mockPrisma.weeklyDebrief.findUnique).toHaveBeenCalledWith({
        where: { userId_weekNumber_year: { userId: 'user-123', weekNumber: 26, year: 2026 } },
      });
    });
  });

  describe('getEligibleUsers (SCA-B5-08)', () => {
    it('seulement ceux qui ont clôturé un trade dans la semaine de refDate, mêmes bornes que generate', async () => {
      const ref = new Date('2026-10-04T21:00:00.000Z'); // dimanche 23 h Paris
      const { startDate, endDate } = service.getWeekInfo(ref);

      await service.getEligibleUsers(ref);

      const where = mockPrisma.user.findMany.mock.calls.at(-1)![0].where;
      expect(where).toMatchObject({ isDemo: false, debriefAutomatic: true });
      // Même filtre que generate : comptes perdus exclus (#947) et trades clôturés seulement (#1056) :
      // une semaine de positions ouvertes ne déclenche ni débrief ni appel IA.
      expect(where.trades).toEqual({
        some: { tradedAt: { gte: startDate, lte: endDate }, pnl: { not: null }, ...inactiveAccountsTradeWhere() },
      });
      expect(where.trades.some.OR).toBeDefined();
    });
  });

  describe('helpers de semaine', () => {
    it('lastCompletedWeekRef → 7 jours avant, tombe dans la semaine précédente', () => {
      const now = new Date('2026-06-29T08:00:00'); // lundi, semaine 27
      const ref = service.lastCompletedWeekRef(now);
      expect(ref.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(service.getWeekInfo(ref).weekNumber).toBe(26);
    });

    it('weekRefDate(2026, 26) → une date de la semaine ISO 26', () => {
      const d = service.weekRefDate(2026, 26);
      expect(service.getWeekInfo(d).weekNumber).toBe(26);
      expect(service.getWeekInfo(d).year).toBe(2026);
    });

    // Compte perdu : le débrief hebdo est un contexte global → comptes échoués et archivés exclus
    // (trades ET liste des comptes analysés), validés gardés.
    it('comptes échoués et archivés hors du débrief (trades et comptes)', async () => {
      mockPrisma.weeklyDebrief.findFirst.mockResolvedValue(null);
      mockPrisma.weeklyDebrief.upsert.mockImplementation((args: { create: unknown }) => Promise.resolve(args.create));
      mockPrisma.tradingAccount.findMany.mockResolvedValue([]);
      // Un trade hors compte (les comptes perdus sont filtrés par la requête elle-même).
      mockPrisma.trade.findMany.mockResolvedValueOnce([
        { asset: 'NQ', side: 'LONG', pnl: 50, emotion: null, setup: null, session: null, tradedAt: new Date(), accountId: null },
      ]);
      mockAiService.generateDebrief.mockResolvedValueOnce({ overview: { summary: '' }, accounts: [], objectives: [] });

      await service.generate('user-123');

      const tradeWhere = mockPrisma.trade.findMany.mock.calls[0][0].where;
      expect(tradeWhere).toMatchObject({
        userId: 'user-123',
        OR: [{ accountId: null }, { account: { status: { notIn: ['FAILED', 'ARCHIVED'] } } }],
      });
      const accountWhere = mockPrisma.tradingAccount.findMany.mock.calls.at(-1)![0].where;
      expect(accountWhere).toEqual({ userId: 'user-123', status: { notIn: ['FAILED', 'ARCHIVED'] } });
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
          // L'IA répond avec les clés reçues (compte-1, compte-2…), jamais les ids internes.
          { accountId: 'compte-1', summary: 'Bon compte.', strengths: [{ badge: 'Force', text: 'risque constant' }], weaknesses: [], objectives: [{ title: 'o', reason: 'r' }], propNote: null },
          { accountId: 'compte-2', summary: 'Éval à lancer.', strengths: [], weaknesses: [], objectives: [], propNote: 'Marge estimée OK (estimation depuis tes trades loggés, pas le calcul officiel de la firme)' },
          { accountId: 'compte-7', summary: 'Clé inventée : ignorée.', strengths: [], weaknesses: [], objectives: [], propNote: null },
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
      expect(aiArg.tradesByAccount['compte-1']).toHaveLength(2);
      // Aucun identifiant interne de compte dans ce qui part vers l'IA (comptes ni trades).
      expect(JSON.stringify({ accounts: aiArg.accounts, tradesByAccount: aiArg.tradesByAccount })).not.toMatch(/acc-perso|acc-eval/);

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
      expect((perso as { summary?: string }).summary).toBe('Bon compte.');
      expect(stored.accounts.some((a) => (a as { summary?: string }).summary === 'Clé inventée : ignorée.')).toBe(false);
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
