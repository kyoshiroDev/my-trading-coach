import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { AnalyticsService } from '../analytics/analytics.service';

const mockAccounts = {
  accountWhere: vi.fn().mockResolvedValue({ accountId: 'acc-1' }),
  ensureDefaultAccountId: vi.fn().mockResolvedValue('acc-default'),
};

const makeTrade = (overrides: Record<string, unknown> = {}) => ({
  id: 'trade-1',
  userId: 'user-1',
  sessionId: 'session-1',
  asset: 'NQ',
  side: 'LONG',
  entry: 100,
  exit: null,
  stopLoss: 95,
  takeProfit: 110,
  pnl: null,
  tags: [],
  ...overrides,
});

const mockPrisma = {
  tradeSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  brokerConnection: {
    findFirst: vi.fn(),
  },
  trade: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
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
const mockAnalytics = { invalidateUserCache: vi.fn().mockResolvedValue(undefined) };

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.tradeSession.findMany.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: AnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  describe('startSession', () => {
    // #994 (N4) : l'ancienne séance était fermée par un updateMany nu, sans totaux : `totalTrades` restait
    // à 0 et elle disparaissait de /sessions (filtre totalTrades > 0). Même clôture que le cron désormais.
    const trades3 = [
      { pnl: 50, commission: 0, asset: 'NQ', tradedAt: new Date(), accountId: 'acc-1' },
      { pnl: -20, commission: 0, asset: 'NQ', tradedAt: new Date(), accountId: 'acc-1' },
      { pnl: 10, commission: 0, asset: 'NQ', tradedAt: new Date(), accountId: 'acc-1' },
    ];

    it('séance d’une journée précédente restée ouverte : clôturée avec ses totaux, fin de SA journée', async () => {
      const veille = new Date(Date.now() - 2 * 86_400_000);
      mockPrisma.tradeSession.findMany.mockResolvedValueOnce([{ id: 'old', accountId: 'acc-1', startedAt: veille }]);
      mockPrisma.trade.findMany.mockResolvedValueOnce(trades3);
      mockPrisma.tradeSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tradeSession.create.mockResolvedValue({ id: 'session-2' });

      await service.startSession('user-1', 'CONFIDENT');

      const call = mockPrisma.tradeSession.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'old', status: 'ACTIVE' });
      expect(call.data).toMatchObject({ status: 'CLOSED', totalTrades: 3 });
      expect(call.data.endedAt.getTime()).toBeLessThan(Date.now());
    });

    it('séance du jour (autre appareil, autre compte) : clôturée maintenant avec ses totaux', async () => {
      mockPrisma.tradeSession.findMany.mockResolvedValueOnce([{ id: 'today', accountId: 'acc-1', startedAt: new Date() }]);
      mockPrisma.trade.findMany.mockResolvedValueOnce(trades3);
      mockPrisma.tradeSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tradeSession.create.mockResolvedValue({ id: 'session-2' });

      const avant = Date.now();
      const result = await service.startSession('user-1', 'CONFIDENT');

      const { data } = mockPrisma.tradeSession.updateMany.mock.calls[0][0];
      expect(data).toMatchObject({ status: 'CLOSED', totalTrades: 3 });
      expect(data.endedAt.getTime()).toBeGreaterThanOrEqual(avant);
      expect(result).toEqual({ id: 'session-2' });
    });

    it('aucune séance ouverte : rien à clôturer', async () => {
      mockPrisma.tradeSession.create.mockResolvedValue({ id: 'session-2' });
      await service.startSession('user-1', 'CONFIDENT');
      expect(mockPrisma.tradeSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getTodaySession (#456)', () => {
    it('session active → renvoyée telle quelle', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValueOnce({ id: 's-active', status: 'ACTIVE' });

      await expect(service.getTodaySession('user-1')).resolves.toEqual({ id: 's-active', status: 'ACTIVE' });
      expect(mockPrisma.tradeSession.findFirst).toHaveBeenCalledTimes(1);
    });

    it('aucune active → dernière session clôturée du jour, avec ses trades', async () => {
      mockPrisma.tradeSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 's-closed', status: 'CLOSED', trades: [] });

      const res = await service.getTodaySession('user-1');

      expect(res).toMatchObject({ id: 's-closed', status: 'CLOSED' });
      const query = mockPrisma.tradeSession.findFirst.mock.calls[1][0];
      expect(query.where).toMatchObject({
        userId: 'user-1',
        status: 'CLOSED',
        startedAt: { gte: expect.any(Date) },
      });
      expect(query.orderBy).toEqual({ endedAt: 'desc' });
      expect(query.include.trades).toBeDefined();
    });
  });

  describe('getTodayTrades', () => {
    it('retourne uniquement les trades du jour', async () => {
      const trades = [makeTrade(), makeTrade({ id: 'trade-2' })];
      mockPrisma.trade.findMany.mockResolvedValue(trades);

      const result = await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            OR: [{ tradedAt: expect.objectContaining({ gte: expect.any(Date) }) }],
          }),
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('session active : son trade encore ouvert reste « en cours » même ouvert avant minuit', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ id: 's-live', accountId: 'acc-session' });
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany.mock.calls[0][0].where.OR).toEqual([
        { tradedAt: { gte: expect.any(Date) } },
        { sessionId: 's-live', pnl: null },
      ]);
    });

    it('session active → seulement les trades de son compte (#457)', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ accountId: 'acc-session' });
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', accountId: 'acc-session' }),
        }),
      );
    });

    it('sans session active → tous les comptes', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTodayTrades('user-1');

      expect(mockPrisma.trade.findMany.mock.calls[0][0].where).not.toHaveProperty('accountId');
    });
  });

  describe('getLiveStats', () => {
    it('calcule correctement le winRate', async () => {
      const trades = [
        makeTrade({ pnl: 100 }),
        makeTrade({ id: 'trade-2', pnl: -50 }),
        makeTrade({ id: 'trade-3', pnl: 200 }),
        makeTrade({ id: 'trade-4', pnl: null }),
      ];
      mockPrisma.trade.findMany.mockResolvedValue(trades);

      const stats = await service.getLiveStats('user-1');

      expect(stats.closedCount).toBe(3);
      expect(stats.tradesCount).toBe(4);
      // 2 wins / 3 closed = 66.67%
      expect(stats.winRate).toBeCloseTo(66.67, 1);
      expect(stats.totalPnl).toBe(250);
    });
  });

  describe('getLiveStats · état broker (positions ouvertes, latent)', () => {
    beforeEach(() => {
      mockPrisma.trade.findMany.mockResolvedValue([makeTrade({ pnl: 100 })]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ accountId: 'acc-tv' });
    });

    it('position ouverte → décrite, avec le latent du broker et sa date', async () => {
      const at = new Date('2026-10-06T14:05:00Z');
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: -42.5, brokerEquityAt: at, brokerOpenPositions: 1,
      });
      const position = { asset: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21_500, since: null };
      mockRedisService.client.get.mockResolvedValueOnce(
        JSON.stringify({ at: '2026-10-06T14:05:00Z', positions: [position] }),
      );

      const stats = await service.getLiveStats('user-1');

      expect(mockRedisService.client.get).toHaveBeenCalledWith('tradovate:positions:conn-1');
      expect(stats.totalPnl).toBe(100); // réalisé seul : le latent reste à part
      expect(stats.broker).toEqual({
        openPositions: [{ ...position, stopPrice: null, targetPrice: null }],
        positionsAt: '2026-10-06T14:05:00Z',
        openPnl: -42.5,
        openPnlAt: at.toISOString(),
      });
    });

    it('ordres actifs lus en direct → SL / TP de la position (#601), contrat jamais exposé', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: 10, brokerEquityAt: null, brokerOpenPositions: 1,
      });
      const position = { asset: 'MNQ', side: 'LONG', quantity: 1, entryPrice: 21_500, since: null, contractId: 7 };
      const orders = [
        { id: 1, contractId: 7, action: 'Sell', orderType: 'Stop', price: null, stopPrice: 21_480, parentId: 9, ocoId: 2 },
        { id: 2, contractId: 7, action: 'Sell', orderType: 'Limit', price: 21_560, stopPrice: null, parentId: 9, ocoId: 1 },
      ];
      mockRedisService.client.get.mockImplementation(async (key: string) =>
        key === 'tradovate:positions:conn-1' ? JSON.stringify({ at: 'x', positions: [position] })
          : key === 'tradovate:orders:conn-1' ? JSON.stringify({ at: 'x', orders })
            : null);

      const { broker } = await service.getLiveStats('user-1');
      mockRedisService.client.get.mockReset().mockResolvedValue(null);

      expect(broker?.openPositions).toEqual([
        { asset: 'MNQ', side: 'LONG', quantity: 1, entryPrice: 21_500, since: null, stopPrice: 21_480, targetPrice: 21_560 },
      ]);
    });

    it('position ouverte mais latent jamais lu → null, pas de chiffre inventé', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: null, brokerEquityAt: null, brokerOpenPositions: 1,
      });
      mockRedisService.client.get.mockResolvedValueOnce(null);

      const { broker } = await service.getLiveStats('user-1');

      expect(broker).toMatchObject({ openPositions: [], openPnl: null, openPnlAt: null });
    });

    it('à plat → latent 0', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: 12, brokerEquityAt: null, brokerOpenPositions: 0,
      });
      mockRedisService.client.get.mockResolvedValueOnce(JSON.stringify({ at: 'x', positions: [] }));

      expect((await service.getLiveStats('user-1')).broker?.openPnl).toBe(0);
    });

    it('compteur en base à 0 mais détail Redis périmé → à plat, comme le suivi du compte', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue({
        id: 'conn-1', brokerOpenPnl: -30, brokerEquityAt: null, brokerOpenPositions: 0,
      });
      const position = { asset: 'MNQ', side: 'LONG', quantity: 1, entryPrice: 21_500, since: null };
      mockRedisService.client.get.mockResolvedValueOnce(JSON.stringify({ at: 'x', positions: [position] }));

      expect((await service.getLiveStats('user-1')).broker).toMatchObject({ openPositions: [], openPnl: 0 });
    });

    it('compte non synchronisé ou sans session active → broker null', async () => {
      mockPrisma.brokerConnection.findFirst.mockResolvedValue(null);
      expect((await service.getLiveStats('user-1')).broker).toBeNull();

      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      expect((await service.getLiveStats('user-1')).broker).toBeNull();
    });
  });

  describe('closeSession', () => {
    // #994 (N13) : double clic, ou onglet resté ouvert sur une séance que le cron a déjà fermée :
    // `endedAt` devenait « maintenant » (durée de 20 h et plus). On garde la fin d'origine ; l'humeur
    // et les notes saisies sont enregistrées quand même (refuser les ferait perdre).
    it('séance déjà clôturée : heure de fin d’origine gardée, humeur enregistrée', async () => {
      const finOrigine = new Date('2026-06-01T22:00:00.000Z');
      mockPrisma.tradeSession.findFirst.mockResolvedValue({
        startedAt: new Date('2026-06-01T08:00:00.000Z'), status: 'CLOSED', endedAt: finOrigine,
      });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });

      await service.closeSession('user-1', 'session-1', 'CONFIDENT');

      const { data } = mockPrisma.tradeSession.update.mock.calls[0][0];
      expect(data.endedAt).toEqual(finOrigine);
      expect(data.moodEnd).toBe('CONFIDENT');
    });

    it('rattache les trades du jour non liés puis recalcule les stats', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({
        startedAt: new Date('2026-06-01T08:00:00.000Z'),
      });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.trade.findMany.mockResolvedValue([
        makeTrade({ pnl: 100, asset: 'NQ' }),
        makeTrade({ id: 'trade-2', pnl: -40, asset: 'ES' }),
      ]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });

      await service.closeSession('user-1', 'session-1', 'CONFIDENT');

      // Rattachement des trades du jour encore non liés
      expect(mockPrisma.trade.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            sessionId: null,
            tradedAt: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
          data: { sessionId: 'session-1' },
        }),
      );

      // Stats recalculées depuis les trades liés
      expect(mockPrisma.tradeSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1', userId: 'user-1' },
          data: expect.objectContaining({
            status: 'CLOSED',
            totalTrades: 2,
            totalPnl: 60,
            winRate: 50,
          }),
        }),
      );
    });

    it("n'inclut que les trades du compte de la session (#457)", async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({
        startedAt: new Date('2026-10-05T13:24:00.000Z'),
        accountId: 'acc-tradeify',
      });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.trade.findMany.mockResolvedValue([makeTrade({ pnl: 330, commission: 26.6 })]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });

      await service.closeSession('user-1', 'session-1', 'CONFIDENT');

      expect(mockPrisma.trade.updateMany.mock.calls[0][0].where).toMatchObject({ accountId: 'acc-tradeify' });
      expect(mockPrisma.trade.findMany.mock.calls[0][0].where).toMatchObject({
        sessionId: 'session-1',
        accountId: 'acc-tradeify',
      });
      expect(mockPrisma.tradeSession.update.mock.calls[0][0].data.totalPnl).toBe(303.4);
    });

    it('lance NotFoundException si la session est introuvable', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);

      await expect(
        service.closeSession('user-1', 'session-x', 'CONFIDENT'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.trade.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('closeTrade', () => {
    it('vide le cache des statistiques de l’utilisateur (le P&L change)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 2 });

      await service.closeTrade('user-1', 'trade-1', 102);

      expect(mockAnalytics.invalidateUserCache).toHaveBeenCalledWith('user-1');
    });

    it('détecte SL pour un LONG (exitPrice <= stopLoss)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: -6, tags: ['SL'] });

      await service.closeTrade('user-1', 'trade-1', 94);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'SL' } }),
        }),
      );
    });

    it('détecte TP pour un LONG (exitPrice >= takeProfit)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 12, tags: ['TP'] });

      await service.closeTrade('user-1', 'trade-1', 112);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'TP' } }),
        }),
      );
    });

    it('détecte MANUAL si ni SL ni TP touché', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 95, takeProfit: 110, side: 'LONG' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 5, tags: ['MANUAL'] });

      await service.closeTrade('user-1', 'trade-1', 105);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'MANUAL' } }),
        }),
      );
    });

    it('détecte SL pour un SHORT (exitPrice >= stopLoss)', async () => {
      const trade = makeTrade({ entry: 100, stopLoss: 105, takeProfit: 90, side: 'SHORT' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: -6, tags: ['SL'] });

      await service.closeTrade('user-1', 'trade-1', 106);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tags: { push: 'SL' } }),
        }),
      );
    });

    it('enregistre le P&L en dollars (valeur du point × quantité), pas l’écart de prix', async () => {
      // MNQ : 0,25 pt = 0,50 $ → 2 $/pt. 2 contrats × 10 pts = 40 $ (avant : 10, l'écart brut).
      const trade = makeTrade({ asset: 'MNQ', entry: 20000, quantity: 2, side: 'LONG', stopLoss: null, takeProfit: null });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 40 });

      await service.closeTrade('user-1', 'trade-1', 20010);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ exit: 20010, pnl: 40 }) }),
      );
    });

    it('trade d’une séance déjà clôturée → totaux de la séance recalculés (pas figés à la clôture)', async () => {
      const trade = makeTrade({ asset: 'MNQ', entry: 20000, quantity: 1, side: 'LONG', stopLoss: null, takeProfit: null, sessionId: 's1' });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 20 });
      mockPrisma.tradeSession.findMany.mockResolvedValue([{ id: 's1', userId: 'user-1', accountId: null }]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { pnl: 100, commission: 0, asset: 'MNQ', tradedAt: new Date('2026-11-10T14:00:00Z'), accountId: null },
        { pnl: 20, commission: 1, asset: 'MNQ', tradedAt: new Date('2026-11-10T15:00:00Z'), accountId: null },
      ]);

      await service.closeTrade('user-1', 'trade-1', 20010);

      expect(mockPrisma.tradeSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['s1'] }, status: 'CLOSED' } }),
      );
      expect(mockPrisma.tradeSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: expect.objectContaining({ totalPnl: 119, totalTrades: 2, winRate: 100 }),
      });
    });

    it('SHORT ES 1 contrat : 5000 → 4990 = +500 $', async () => {
      const trade = makeTrade({ asset: 'ES', entry: 5000, quantity: 1, side: 'SHORT', stopLoss: null, takeProfit: null });
      mockPrisma.trade.findFirst.mockResolvedValue(trade);
      mockPrisma.trade.update.mockResolvedValue({ ...trade, pnl: 500 });

      await service.closeTrade('user-1', 'trade-1', 4990);

      expect(mockPrisma.trade.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pnl: 500 }) }),
      );
    });

    it('lance NotFoundException si trade introuvable', async () => {
      mockPrisma.trade.findFirst.mockResolvedValue(null);

      await expect(service.closeTrade('user-1', 'trade-x', 100)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('session active bornée à la journée de trading (#595)', () => {
    it('getActiveSession ne renvoie que les sessions ouvertes depuis le début de la journée CME', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      await service.getActiveSession('user-1');
      expect(mockPrisma.tradeSession.findFirst.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        status: 'ACTIVE',
        startedAt: { gte: expect.any(Date) },
      });
    });

    it('stats live : la session d’un jour précédent ne filtre plus le compte', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValue([]);
      await service.getTodayTrades('user-1');
      expect(mockPrisma.tradeSession.findFirst.mock.calls[0][0].where.startedAt).toEqual({ gte: expect.any(Date) });
    });
  });

  describe('« aujourd’hui » = journée de trading CME, pas minuit serveur (audit des chiffres, lot 3)', () => {
    // Semaine de décalage : Paris en heure d'hiver, Chicago encore en été. 23:30 à Paris = 17:30 à
    // Chicago : la journée CME du 29/10 a commencé à 22:00 UTC, minuit serveur (Paris) est à 23:00 UTC la veille.
    const NOW = new Date('2026-10-28T22:30:00.000Z');
    const CME_START = new Date('2026-10-28T22:00:00.000Z');
    const CME_END = new Date('2026-10-29T22:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it('getTodayTrades part du début de la journée CME', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.findMany.mockResolvedValue([]);
      await service.getTodayTrades('user-1');
      expect(mockPrisma.trade.findMany.mock.calls[0][0].where.OR).toEqual([{ tradedAt: { gte: CME_START } }]);
    });

    it('getTodaySession : la session clôturée du jour est cherchée depuis le début de la journée CME', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await service.getTodaySession('user-1');
      expect(mockPrisma.tradeSession.findFirst.mock.calls[1][0].where.startedAt).toEqual({ gte: CME_START });
    });

    it('closeSession rattache les trades de la journée CME de la session, borne haute exclue', async () => {
      mockPrisma.tradeSession.findFirst.mockResolvedValue({ startedAt: NOW, accountId: null });
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.tradeSession.update.mockResolvedValue({ id: 'session-1' });
      await service.closeSession('user-1', 'session-1', 'CONFIDENT');
      expect(mockPrisma.trade.updateMany.mock.calls[0][0].where.tradedAt).toEqual({ gte: CME_START, lt: CME_END });
    });
  });

  describe('closeStaleSessions (#595)', () => {
    const now = new Date('2026-10-17T22:05:00Z'); // 17:05 Chicago, juste après la bascule

    it('clôture les sessions ouvertes avec les totaux de LEURS trades, à la fin de leur journée', async () => {
      mockPrisma.tradeSession.findMany.mockResolvedValue([
        { id: 's1', userId: 'user-1', accountId: 'acc-1', startedAt: new Date('2026-10-17T13:00:00Z') },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([
        { pnl: 100, commission: 5, asset: 'MNQ' },
        { pnl: -40, commission: 5, asset: 'MNQ' },
      ]);
      mockPrisma.tradeSession.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.closeStaleSessions(now)).resolves.toBe(1);

      expect(mockPrisma.trade.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', sessionId: 's1', accountId: 'acc-1' });
      expect(mockPrisma.trade.updateMany).not.toHaveBeenCalled(); // aucun trade rattaché après coup
      expect(mockPrisma.tradeSession.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', status: 'ACTIVE' },
        data: {
          status: 'CLOSED',
          endedAt: new Date('2026-10-17T22:00:00.000Z'),
          totalPnl: 50,
          totalTrades: 2,
          winRate: 50,
          maxDrawdown: -45,
          bestTradePnl: 95,
          bestTradeAsset: 'MNQ',
        },
      });
      expect(mockRedisService.client.del).toHaveBeenCalledWith('session:active:user-1');
    });

    it('cible exactement les sessions que la règle « active » ne renvoie plus, hors démo', async () => {
      mockPrisma.tradeSession.findMany.mockResolvedValue([]);
      await service.closeStaleSessions(now);
      expect(mockPrisma.tradeSession.findMany.mock.calls[0][0].where).toEqual({
        status: 'ACTIVE',
        startedAt: { lt: new Date('2026-10-17T22:00:00.000Z') },
        user: { isDemo: false },
      });
    });

    it('semaine de décalage (Paris en heure d’hiver, Chicago encore en été) : bascule à 17:00 Chicago = 23:00 Paris', async () => {
      mockPrisma.tradeSession.findMany.mockResolvedValue([]);
      await service.closeStaleSessions(new Date('2026-10-28T22:05:00Z'));
      expect(mockPrisma.tradeSession.findMany.mock.calls[0][0].where.startedAt).toEqual({ lt: new Date('2026-10-28T22:00:00.000Z') });
    });

    it('session déjà clôturée à la main entre-temps : rien d’écrasé', async () => {
      mockPrisma.tradeSession.findMany.mockResolvedValue([
        { id: 's1', userId: 'user-1', accountId: null, startedAt: new Date('2026-10-17T13:00:00Z') },
      ]);
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.tradeSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.closeStaleSessions(now)).resolves.toBe(0);
      expect(mockRedisService.client.del).not.toHaveBeenCalled();
    });
  });
});
