import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  TradeSide,
  EmotionState,
  TradingSession,
} from '@prisma/client';
import { TradesService } from './trades.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { RedisService } from '../infra/redis.service';
import { AccountsService } from '../accounts/accounts.service';
import { SetupsService } from '../setups/setups.service';
import { netPnl } from '@mtc/shared';
import { Prisma } from '@prisma/client';
import { summarizeJournal } from './journal-stats.util';

const mockTrade = {
  id: 'trade-123',
  userId: 'user-123',
  asset: 'BTC/USDT',
  side: TradeSide.LONG,
  entry: 50000,
  exit: 52000,
  stopLoss: 49000,
  takeProfit: 53000,
  pnl: 2000,
  riskReward: 2,
  emotion: EmotionState.CONFIDENT,
  setupId: 'setup-1',
  session: TradingSession.LONDON,
  timeframe: '1H',
  notes: null,
  tags: [],
  tradedAt: new Date(),
  createdAt: new Date(),
};

const createTradeDto: CreateTradeDto = {
  asset: 'BTC/USDT',
  side: TradeSide.LONG,
  entry: 50000,
  exit: 52000,
  emotion: EmotionState.CONFIDENT,
  setupId: 'setup-1',
  session: TradingSession.LONDON,
  timeframe: '1H',
};

const mockPrisma = {
  $queryRaw: vi.fn(),
  trade: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  // Recalcul comportemental par lot : transaction des updates.
  $transaction: vi.fn((ops) => Promise.resolve(Array.isArray(ops) ? ops : [])),
  tradeSession: {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null), // moodStart (note d'exécution)
  },
  // Compte cible pour la note d'exécution (capital) — null par défaut (critère risque ignoré).
  tradingAccount: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  // Inscription ancienne par défaut → les trades de test (datés récemment) sont post-inscription.
  user: {
    findUnique: vi.fn().mockResolvedValue({ createdAt: new Date('2020-01-01') }),
  },
};

const mockAnalytics = { invalidateUserCache: vi.fn().mockResolvedValue(undefined) };


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
const mockAccounts = {
  accountWhere: vi.fn(),
  ensureDefaultAccountId: vi.fn(),
};

describe('TradesService', () => {
  let service: TradesService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAccounts.accountWhere.mockResolvedValue({ accountId: 'acc-1' });
    mockAccounts.ensureDefaultAccountId.mockResolvedValue('acc-default');
    mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
    // Défaut : le recalcul comportemental par lot ne trouve aucun trade (no-op) sauf override par test.
    mockPrisma.trade.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((ops) => Promise.resolve(Array.isArray(ops) ? ops : []));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        TradesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: AccountsService, useValue: mockAccounts },
        { provide: SetupsService, useValue: { assertOwnedActive: vi.fn().mockResolvedValue(undefined), getImportSetupId: vi.fn().mockResolvedValue('setup-default') } },
      ],
    }).compile();

    service = module.get<TradesService>(TradesService);
  });

  describe('create', () => {
    describe('Trades illimités (plus de quota de trades en FREE)', () => {
      it('crée sans limite quel que soit le nombre de trades existants', async () => {
        mockPrisma.trade.count.mockResolvedValue(9999);
        mockPrisma.trade.create.mockResolvedValue(mockTrade);

        await expect(
          service.create('user-123', createTradeDto),
        ).resolves.toBeDefined();
      });
    });

    describe('Chaîne de fallback accountId (jamais orphelin)', () => {
      beforeEach(() => {
        mockPrisma.trade.count.mockResolvedValue(0);
        mockPrisma.trade.create.mockResolvedValue(mockTrade);
      });

      it('accountId du dto fourni → résolu via accountWhere (priorité 1)', async () => {
        mockAccounts.accountWhere.mockResolvedValue({ accountId: 'acc-dto' });
        await service.create('user-123', { ...createTradeDto, accountId: 'acc-dto' });
        expect(mockAccounts.accountWhere).toHaveBeenCalledWith('user-123', 'acc-dto');
        expect(mockPrisma.trade.create.mock.calls[0][0].data.accountId).toBe('acc-dto');
        expect(mockAccounts.ensureDefaultAccountId).not.toHaveBeenCalled();
      });

      it("dto 'all' (agrégé) → ignoré, hérite de la session active (priorité 2)", async () => {
        mockPrisma.tradeSession.findFirst.mockResolvedValue({ id: 's1', accountId: 'acc-session' });
        await service.create('user-123', { ...createTradeDto, accountId: 'all' });
        expect(mockAccounts.accountWhere).not.toHaveBeenCalled();
        expect(mockPrisma.trade.create.mock.calls[0][0].data.accountId).toBe('acc-session');
      });

      it('aucun accountId, aucune session → compte par défaut (priorité 3, anti-NULL)', async () => {
        mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
        await service.create('user-123', createTradeDto);
        expect(mockAccounts.ensureDefaultAccountId).toHaveBeenCalledWith('user-123');
        expect(mockPrisma.trade.create.mock.calls[0][0].data.accountId).toBe('acc-default');
      });
    });

    it('calcule le PnL automatiquement si entry et exit fournis', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create(
        'user-123',
        createTradeDto,
      );

      expect(result.pnl).toBe(2000); // exit - entry = 52000 - 50000 = 2000 LONG
    });
  });

  describe('findAll', () => {
    describe('Historique illimité FREE', () => {
      it('ne filtre PAS les trades par date pour FREE', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);

        await service.findAll('user-123', {});

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.tradedAt).toBeUndefined();
      });

      it('applique uniquement le filtre userId par défaut', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);

        await service.findAll('user-123', {});

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.userId).toBe('user-123');
      });

      it('applique le filtre dateFrom si fourni', async () => {
        mockPrisma.trade.findMany.mockResolvedValue([]);
        const dateFrom = '2026-01-01';

        await service.findAll('user-123', { dateFrom });

        const call = mockPrisma.trade.findMany.mock.calls[0][0];
        expect(call.where?.tradedAt?.gte).toBeDefined();
      });
    });

    it('retourne les données avec pagination curseur', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([mockTrade]);

      const result = await service.findAll('user-123', { limit: 20 });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasNextPage');
    });
  });

  describe('findOne', () => {
    it('lance NotFoundException si trade introuvable', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(null);

      await expect(service.findOne('user-123', 'unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lance ForbiddenException si trade appartient à un autre utilisateur', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue({
        ...mockTrade,
        userId: 'other-user',
      });

      await expect(service.findOne('user-123', 'trade-123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('retourne le trade si userId correspond', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade);

      const result = await service.findOne('user-123', 'trade-123');

      expect(result.id).toBe('trade-123');
    });
  });

  describe('calculatePnl — commission', () => {
    it('soustrait la commission du P&L NQ calculé via entry/exit', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'NQ',
        side: TradeSide.LONG,
        entry: 20000,
        exit: 20010,
        quantity: 1,
        commission: 5,
        emotion: EmotionState.CONFIDENT,
        setupId: 'setup-1',
        session: TradingSession.LONDON,
        timeframe: '1m',
      });

      // NQ: 10 ticks × $20 = $200 BRUT stocké ; les $5 de frais restent dans `commission`
      // (net $195 calculé à la lecture par netPnl).
      expect(result.pnl).toBe(200);
      expect(result.commission).toBe(5);
    });

    it('fonctionne sans commission (commission = 0)', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'MES',
        side: TradeSide.LONG,
        entry: 5000,
        exit: 5010,
        quantity: 1,
        emotion: EmotionState.CONFIDENT,
        setupId: 'setup-1',
        session: TradingSession.LONDON,
        timeframe: '5m',
      });

      // MES: 10 ticks × $5 = $50 brut, pas de commission
      expect(result.pnl).toBeCloseTo(50);
    });

    it('accepte commission négative (valeur absolue utilisée)', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      const result = await service.create('user-123', {
        asset: 'NQ',
        side: TradeSide.LONG,
        entry: 20000,
        exit: 20010,
        quantity: 1,
        commission: -5,
        emotion: EmotionState.CONFIDENT,
        setupId: 'setup-1',
        session: TradingSession.LONDON,
        timeframe: '1m',
      });

      // P&L stocké brut ; le net (valeur absolue des frais) : netPnl → 195
      expect(result.pnl).toBe(200);
      expect(netPnl(result)).toBe(195);
    });

    it('garde BRUT un P&L fourni manuellement (frais à part)', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      // P&L brut fourni manuellement, pas d'exit
      const result = await service.create('user-123', {
        asset: 'BTC/USDT',
        side: TradeSide.LONG,
        entry: 50000,
        pnl: 200,
        commission: 8,
        emotion: EmotionState.CONFIDENT,
        setupId: 'setup-1',
        session: TradingSession.LONDON,
        timeframe: '1h',
      });

      // dto.pnl prend la priorité dans create() (dto.pnl ?? pnl)
      // donc le result.pnl = dto.pnl = 200 (pas de recalcul côté backend)
      expect(result.pnl).toBe(200);
    });
  });

  describe('calculatePnl — P&L réalisé fourni prime sur le recalcul (fix MEXC ×contrat)', () => {
    it('import MEXC : avec {entry, exit, quantity, pnl} fournis → garde le P&L réalisé, jamais points×contrats', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      // Sample MEXC : BTCUSDT short, 200 contrats, realized PnL fichier = 5.136.
      // Le recalcul fautif donnerait points×qty = (60750-60493.2)×200 = 51360.
      const result = await service.create('user-123', {
        asset: 'BTC/USDT',
        side: TradeSide.SHORT,
        entry: 60750,
        exit: 60493.2,
        quantity: 200,
        pnl: 5.136,
        emotion: EmotionState.NEUTRAL,
        setupId: 'setup-1',
        session: TradingSession.NEW_YORK,
        timeframe: '5m',
      });

      expect(result.pnl).toBe(5.136);
      expect(result.pnl).not.toBe(51360);
    });

    it('édition d\'un trade MEXC importé (le form renvoie le pnl) → P&L inchangé, pas de recalcul ×contrat', async () => {
      const existingTrade = {
        ...mockTrade,
        asset: 'BTC/USDT',
        side: TradeSide.SHORT,
        entry: 60750,
        exit: 60493.2,
        quantity: 200,
        pnl: 5.136,
        commission: 0,
      };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      // Cas Nath : changer l'émotion ; le form resoumet le pnl existant → priceFieldsChanged = true.
      const result = await service.update('user-123', 'trade-123', {
        emotion: EmotionState.STRESSED,
        pnl: 5.136,
      });

      // calculatePnl arrondit à 2 décimales (toFixed) → 5.14. Le point clé : PAS 51360.
      expect(result.pnl).toBe(5.14);
      expect(result.pnl).not.toBe(51360);
    });

    it('régression futures : le pnl fourni par le form (NQ) est stocké tel quel, comme avant le patch', async () => {
      mockPrisma.trade.count.mockResolvedValue(0);
      mockPrisma.trade.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );

      // NQ : le form calcule 10 ticks × $20 = 200 et envoie pnl=200.
      // create stocke `dto.pnl ?? pnl` → 200 (inchangé avant/après le patch).
      const result = await service.create('user-123', {
        asset: 'NQ',
        side: TradeSide.LONG,
        entry: 20000,
        exit: 20010,
        quantity: 1,
        pnl: 200,
        emotion: EmotionState.CONFIDENT,
        setupId: 'setup-1',
        session: TradingSession.LONDON,
        timeframe: '1m',
      });

      expect(result.pnl).toBe(200);
    });
  });

  describe('update — recalcule P&L si prix changent', () => {
    it('applique le P&L recalculé par le form quand l\'exit change', async () => {
      const existingTrade = {
        ...mockTrade,
        asset: 'NQ',
        entry: 20000,
        exit: 20010,
        pnl: 200,
        commission: 0,
      };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      // Sur changement de prix, le form (recalculate) renvoie le nouveau pnl avec l'exit.
      // NQ: 5 ticks × $20 = $100 → le backend respecte ce pnl fourni.
      const result = await service.update('user-123', 'trade-123', {
        exit: 20005,
        pnl: 100,
      });

      expect(result.pnl).toBe(100);
    });

    it('garde le P&L BRUT quand une commission est ajoutée (frais à part)', async () => {
      const existingTrade = {
        ...mockTrade,
        asset: 'NQ',
        entry: 20000,
        exit: 20010,
        pnl: 200,
        commission: null,
      };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      const result = await service.update('user-123', 'trade-123', {
        commission: 10,
      });

      // NQ: 10 ticks × $20 = $200 brut ; les $10 de frais restent dans `commission`
      // (le net 190 est calculé à la lecture par netPnl).
      expect(result.pnl).toBe(200);
      expect(result.commission).toBe(10);
    });

    it('ne recalcule pas le P&L si seuls setup/emotion changent', async () => {
      const existingTrade = { ...mockTrade, pnl: 2000 };
      mockPrisma.trade.findUnique.mockResolvedValue(existingTrade);
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...existingTrade, ...data }),
      );

      const result = await service.update('user-123', 'trade-123', {
        setupId: 'setup-2',
      });

      // P&L inchangé — pas de recalcul
      expect(result.pnl).toBe(2000);
    });
  });

  // un setup archivé ne doit plus geler les trades qui l'utilisent.
  // Le front renvoie le DTO complet à chaque édition : revalider un `setupId`
  // inchangé rendait tout trade historique non modifiable dès que son setup était
  // archivé (« Setup invalide » en corrigeant une simple note).
  describe('update — setup archivé', () => {
    let setups: { assertOwnedActive: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      setups = service['setups'] as unknown as { assertOwnedActive: ReturnType<typeof vi.fn> };
      setups.assertOwnedActive.mockReset().mockResolvedValue(undefined);
      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade); // setupId: 'setup-1'
      mockPrisma.trade.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...mockTrade, ...data }),
      );
    });

    it('setupId inchangé (même archivé) → pas de revalidation, édition acceptée', async () => {
      await service.update('user-123', 'trade-123', {
        setupId: 'setup-1', // identique à l'existant
        notes: 'correction de note',
      });

      expect(
        setups.assertOwnedActive,
        "Un setup qu'on ne modifie pas ne doit pas être revalidé",
      ).not.toHaveBeenCalled();
    });

    it('changement de setup → validation stricte conservée', async () => {
      await service.update('user-123', 'trade-123', { setupId: 'setup-2' });

      expect(setups.assertOwnedActive).toHaveBeenCalledWith('user-123', 'setup-2');
    });

    it('changement vers un setup archivé → rejeté', async () => {
      setups.assertOwnedActive.mockRejectedValue(
        new BadRequestException('Setup invalide (inconnu, archivé, ou hors de ton compte).'),
      );

      await expect(
        service.update('user-123', 'trade-123', { setupId: 'setup-archive' }),
      ).rejects.toThrow('Setup invalide');
    });

    it('édition sans setupId → aucune validation de setup', async () => {
      await service.update('user-123', 'trade-123', { notes: 'juste une note' });

      expect(setups.assertOwnedActive).not.toHaveBeenCalled();
    });
  });

  describe('importTrades — déduplication', () => {
    const tradedAt = new Date('2026-05-30T14:31:55.000Z');
    const row = (asset: string) => ({ asset, side: TradeSide.LONG, tradedAt, entry: 100, exit: 110, pnl: 10 });
    const dto = (asset: string): Partial<CreateTradeDto> => ({
      asset, side: TradeSide.LONG, entry: 100, exit: 110, pnl: 10,
      emotion: EmotionState.NEUTRAL, setupId: 'setup-1',
      session: TradingSession.LONDON, timeframe: '1h', tradedAt: tradedAt.toISOString(),
    });
    const hashes = () => mockPrisma.trade.create.mock.calls.map((c: unknown[]) => (c[0] as { data: { importHash: string } }).data.importHash);

    it('skip les trades déjà en base ; deux lignes identiques du lot sont deux trades', async () => {
      // Une ligne répétée dans une même source n'est pas un doublon : un trade à plusieurs
      // contrats arrive en plusieurs paires Tradovate identiques (synchro de Val, 14/09/2026).
      mockPrisma.trade.findMany.mockResolvedValue([row('BTC/USDT')]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const res = await service.importTrades(
        'user-123',
        [dto('BTC/USDT'), dto('ETH/USDT'), dto('ETH/USDT')], // BTC déjà en base + ETH ×2
      );

      expect(res.total).toBe(3);
      expect(res.created).toBe(2); // les deux ETH
      expect(res.duplicates).toBe(1); // BTC déjà en base
      const [first, second] = hashes();
      expect(second).toBe(`${first}#2`);
    });

    it('réimport de la même source : aucune répétition recréée', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([row('ETH/USDT'), row('ETH/USDT')]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);

      const res = await service.importTrades('user-123', [dto('ETH/USDT'), dto('ETH/USDT')]);

      expect(res).toMatchObject({ created: 0, duplicates: 2 });
      expect(mockPrisma.trade.create).not.toHaveBeenCalled();
    });

    it('répétition présente une seule fois en base : seules les manquantes sont créées', async () => {
      // Cas de Val : 4 paires identiques, 1 seule importée avant le correctif.
      mockPrisma.trade.findMany.mockResolvedValue([row('ETH/USDT')]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const res = await service.importTrades('user-123', [dto('ETH/USDT'), dto('ETH/USDT'), dto('ETH/USDT'), dto('ETH/USDT')]);

      expect(res).toMatchObject({ created: 3, duplicates: 1 });
      expect(hashes().map((h: string) => h.split('#')[1])).toEqual(['2', '3', '4']);
    });

    it('CSV importé après la synchro : même trade décalé d’un fuseau entier → doublon, un-pour-un', async () => {
      // Export Performance sans fuseau, lu à l'heure de Paris (14:31:55 UTC → 12:31:55), face à
      // 2 paires identiques déjà synchronisées par l'API.
      mockPrisma.trade.findMany.mockResolvedValue([row('ETH/USDT'), row('ETH/USDT')]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);
      const paris = { ...dto('ETH/USDT'), tradedAt: '2026-05-30T12:31:55.000Z' };

      const res = await service.importTrades('user-123', [paris, { ...paris }, { ...paris }]);

      // 2 lignes absorbées par les 2 trades synchronisés ; la 3e est un trade de plus.
      expect(res).toMatchObject({ created: 1, duplicates: 2 });
    });

    it('écart qui n’est pas un fuseau entier → trade distinct, importé', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([row('ETH/USDT')]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const res = await service.importTrades('user-123', [{ ...dto('ETH/USDT'), tradedAt: '2026-05-30T12:32:55.000Z' }]);

      expect(res).toMatchObject({ created: 1, duplicates: 0 });
    });

    it('crée tous les trades quand aucun doublon', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);
      mockPrisma.tradeSession.findFirst.mockResolvedValue(null);
      mockPrisma.trade.create.mockResolvedValue(mockTrade);

      const res = await service.importTrades(
        'user-123',
        [createTradeDto, { ...createTradeDto, asset: 'ETH/USDT' }],
      );

      expect(res.created).toBe(2);
      expect(res.duplicates).toBe(0);
    });

  });

  describe('countDuplicates / removeDuplicates', () => {
    const dupRows = [
      { id: 'a', asset: 'BTC/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-01T10:00:00Z'), entry: 100, exit: 110, pnl: 10 },
      { id: 'b', asset: 'BTC/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-01T10:00:00Z'), entry: 100, exit: 110, pnl: 10 }, // doublon de a
      { id: 'c', asset: 'ETH/USDT', side: TradeSide.LONG, tradedAt: new Date('2026-01-02T10:00:00Z'), entry: 50, exit: 55, pnl: 5 },
    ];

    it('countDuplicates compte les lignes en trop', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(dupRows);
      const res = await service.countDuplicates('user-123');
      expect(res.total).toBe(3);
      expect(res.unique).toBe(2);
      expect(res.duplicates).toBe(1);
    });

    it('removeDuplicates supprime les copies en gardant 1 occurrence', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(dupRows);
      mockPrisma.trade.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.removeDuplicates('user-123');

      expect(res.removed).toBe(1);
      expect(res.kept).toBe(2);
      expect(mockPrisma.trade.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['b'] }, userId: 'user-123' },
      });
    });

    it('removeDuplicates ne supprime rien si aucun doublon', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([dupRows[0], dupRows[2]]);

      const res = await service.removeDuplicates('user-123');

      expect(res.removed).toBe(0);
      expect(mockPrisma.trade.deleteMany).not.toHaveBeenCalled();
    });

    it('une répétition légitime (empreinte #2) n’est jamais un doublon', async () => {
      // Deux paires identiques d'un trade à plusieurs contrats : mêmes champs, empreintes distinctes.
      const key = 'BTC/USDT|LONG|2026-01-01T10:00:00.000Z|100|110|10';
      const legit = [{ ...dupRows[0], importHash: key }, { ...dupRows[1], importHash: `${key}#2` }];
      mockPrisma.trade.findMany.mockResolvedValue(legit);

      expect((await service.countDuplicates('user-123')).duplicates).toBe(0);
      expect((await service.removeDuplicates('user-123')).removed).toBe(0);
      expect(mockPrisma.trade.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('reassignAccount', () => {
    it('scope updateMany sur userId + accountId, retourne le nombre déplacé', async () => {
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 3 });

      const res = await service.reassignAccount('user-1', ['t1', 't2', 't3'], 'acc-target');

      expect(mockPrisma.trade.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t1', 't2', 't3'] }, userId: 'user-1' },
        data: { accountId: 'acc-target' },
      });
      expect(res).toEqual({ moved: 3 });
    });

    it('invalide le cache analytics du user après déplacement', async () => {
      mockPrisma.trade.updateMany.mockResolvedValue({ count: 1 });

      await service.reassignAccount('user-1', ['t1'], 'acc-target');

      expect(mockAnalytics.invalidateUserCache).toHaveBeenCalledWith('user-1');
    });
  });

  describe('computeJournalStats', () => {
    // Calcul en base depuis SCA-B2-02 : ici le câblage (filtre transmis, mise en forme). Les
    // valeurs réelles sont vérifiées sur Postgres contre l'ancien calcul (journal-stats-sql.int-spec.ts).
    const sqlOf = () => {
      const q = mockPrisma.$queryRaw.mock.calls.at(-1)?.[0] as Prisma.Sql;
      return { text: q.text.replace(/\s+/g, ' '), values: q.values };
    };

    it('met en forme l’agrégat SQL : win rate sur les décisifs, net = brut − frais, best/worst', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ total: 3, wins: 2, losses: 1, brut: 250, fees: 7, best: 200, worst: -52 }]);

      const r = await service.computeJournalStats('user-123', {});

      expect(r).toEqual({ totalTrades: 3, winRate: (2 / 3) * 100, pnlBrut: 250, fees: 7, pnlNet: 243, bestTrade: 200, worstTrade: -52 });
    });

    it('ensemble vide → tout à 0 (pas de best/worst aberrant)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ total: 0, wins: 0, losses: 0, brut: 0, fees: 0, best: null, worst: null }]);

      const r = await service.computeJournalStats('user-123', {});

      expect(r).toEqual({ totalTrades: 0, winRate: 0, pnlBrut: 0, fees: 0, pnlNet: 0, bestTrade: 0, worstTrade: 0 });
    });

    it('répercute les filtres (date/side/setup) en paramètres liés, et ne charge plus les trades', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);
      mockPrisma.trade.findMany.mockClear();

      await service.computeJournalStats('user-123', {
        dateFrom: '2026-06-01T00:00:00.000Z',
        dateTo: '2026-06-30T23:59:59.000Z',
        side: TradeSide.LONG,
        setupId: 'setup-1',
      });

      const { text, values } = sqlOf();
      expect(text).toContain('t."userId" = $');
      expect(text).toContain('t."side"::text = $');
      expect(text).toContain('t."setupId" = $');
      expect(text).toContain('t."tradedAt" >= $');
      expect(values).toEqual(expect.arrayContaining(['user-123', TradeSide.LONG, 'setup-1', new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-30T23:59:59.000Z')]));
      expect(mockPrisma.trade.findMany).not.toHaveBeenCalled();
    });

    it('l’étalon summarizeJournal garde ses règles (ouverts comptés, frais en valeur absolue)', () => {
      expect(summarizeJournal([{ pnl: 100, commission: 5 }, { pnl: -50, commission: -2 }, { pnl: null, commission: 1 }])).toEqual({
        totalTrades: 3, winRate: 50, pnlBrut: 50, fees: 8, pnlNet: 42, bestTrade: 95, worstTrade: -52,
      });
    });
  });

  // ── Recalcul comportemental par lot ──────────────────────────
  describe('recomputeBehavioralGrades', () => {
    // Fabrique N trades sans stop, même jour, espacés de 20 min, tous perdants (-100, qty 1).
    type GradedTradeFixture = {
      id: string;
      pnl: number;
      quantity: number;
      tradedAt: Date;
      stopLoss: number | null;
      executionScore: number | null;
      executionGrade: string | null;
      executionMethod: string | null;
    };
    const buildTrades = (n: number): GradedTradeFixture[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        pnl: -100,
        quantity: 1,
        tradedAt: new Date(2026, 6, 10, 14, i * 20, 0), // 14:00, 14:20, 14:40…
        stopLoss: null,
        executionScore: null,
        executionGrade: null,
        executionMethod: null,
      }));

    it('19 trades clôturés → historique insuffisant → aucune note posée', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(buildTrades(19));
      await service.recomputeBehavioralGrades('acc-1');
      expect(mockPrisma.trade.findMany).toHaveBeenCalledTimes(1); // une seule passe, pas de N+1
      expect(mockPrisma.trade.update).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('20 trades → grades comportementaux posés (BEHAVIORAL), en une transaction', async () => {
      mockPrisma.trade.findMany.mockResolvedValue(buildTrades(20));
      await service.recomputeBehavioralGrades('acc-1');
      expect(mockPrisma.trade.findMany).toHaveBeenCalledTimes(1);
      // 1er trade : ni perte précédente ni prior same-day loss → 1 critère → null (pas d'update).
      // Trades 1..19 : perte contenue + revenge (>10 min) + taille constante → EXCELLENT.
      expect(mockPrisma.trade.update).toHaveBeenCalledTimes(19);
      const call = mockPrisma.trade.update.mock.calls[0][0];
      expect(call.data.executionGrade).toBe('EXCELLENT');
      expect(call.data.executionMethod).toBe('BEHAVIORAL');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('trade AVEC stop loss ignoré par le barème comportemental (barème A conservé)', async () => {
      const trades = buildTrades(20);
      trades[5].stopLoss = 42; // ce trade relève du barème A → non touché
      trades[5].executionGrade = 'BON';
      trades[5].executionMethod = 'STOP_BASED';
      mockPrisma.trade.findMany.mockResolvedValue(trades);
      await service.recomputeBehavioralGrades('acc-1');
      const updatedIds = mockPrisma.trade.update.mock.calls.map((c) => c[0].where.id);
      expect(updatedIds).not.toContain('t5');
    });
  });

  /**
   * `create()` et `update()` doivent renvoyer `effectiveEmotion`.
   *
   * Retour de Nath (Discord) : apres un changement d'emotion, l'UI affichait
   * « non renseignee » jusqu'a F5. `findAll()` calculait bien le champ, pas les deux
   * autres — et `trades.store.updateTrade()` remplace l'objet en store par la reponse
   * de l'API, donc le champ absent ecrasait la valeur affichee.
   *
   * Attention en lisant ces tests : le double Prisma renvoie ce qu'on lui dit, quel que
   * soit l'`include`. Verifier seulement la valeur de sortie passerait au vert meme sans
   * le `tradeSession` dans l'include — c'est-a-dire avec le bug intact en production, ou
   * `moodStart` ne serait jamais charge. Chaque test verifie donc AUSSI l'include.
   */
  describe('effectiveEmotion dans la reponse immediate (create / update)', () => {
    const withSession = (moodStart: string | null, emotion: string | null) => ({
      ...mockTrade,
      emotion,
      sessionId: 'sess-1',
      tradeSession: moodStart === null ? null : { moodStart },
    });

    it('create : sans emotion, herite du moodStart de la session ouverte', async () => {
      mockPrisma.trade.create.mockResolvedValue(
        withSession(EmotionState.CONFIDENT, null),
      );

      const res = await service.create('user-123', {
        ...createTradeDto,
        emotion: undefined,
      } as CreateTradeDto);

      expect(res.effectiveEmotion).toBe(EmotionState.CONFIDENT);
    });

    it('create : demande bien tradeSession.moodStart a Prisma', async () => {
      mockPrisma.trade.create.mockResolvedValue(withSession(EmotionState.FOCUSED, null));

      await service.create('user-123', createTradeDto);

      const { include } = mockPrisma.trade.create.mock.calls[0][0];
      expect(
        include.tradeSession,
        'Sans cet include, moodStart est absent en prod et effectiveEmotion vaut toujours null',
      ).toEqual({ select: { moodStart: true } });
    });

    it('create : l\'emotion du trade prime sur le moodStart (override)', async () => {
      mockPrisma.trade.create.mockResolvedValue(
        withSession(EmotionState.NEUTRAL, EmotionState.REVENGE),
      );

      const res = await service.create('user-123', createTradeDto);

      expect(res.effectiveEmotion).toBe(EmotionState.REVENGE);
    });

    it('create : ni emotion ni session → null, jamais un faux NEUTRAL', async () => {
      mockPrisma.trade.create.mockResolvedValue(withSession(null, null));

      const res = await service.create('user-123', createTradeDto);

      expect(res.effectiveEmotion).toBeNull();
    });

    it('update : le changement d\'emotion revient dans la reponse (bug Nath)', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(withSession(EmotionState.NEUTRAL, null));
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...withSession(EmotionState.NEUTRAL, null), ...data }),
      );

      const res = await service.update('user-123', 'trade-123', {
        emotion: EmotionState.STRESSED,
      });

      expect(
        res.effectiveEmotion,
        'Le store remplace le trade par cette reponse : sans le champ, l\'UI affiche « non renseignee »',
      ).toBe(EmotionState.STRESSED);
    });

    it('update : demande bien tradeSession.moodStart a Prisma', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(withSession(EmotionState.FOCUSED, null));
      mockPrisma.trade.update.mockResolvedValue(withSession(EmotionState.FOCUSED, null));

      await service.update('user-123', 'trade-123', { notes: 'rien' });

      const { include } = mockPrisma.trade.update.mock.calls[0][0];
      expect(include.tradeSession).toEqual({ select: { moodStart: true } });
    });

    it('update : retirer l\'override fait retomber sur le moodStart', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(
        withSession(EmotionState.FOCUSED, EmotionState.REVENGE),
      );
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...withSession(EmotionState.FOCUSED, null), ...data }),
      );

      const res = await service.update('user-123', 'trade-123', { emotion: null } as never);

      expect(res.effectiveEmotion).toBe(EmotionState.FOCUSED);
    });

    it('update : calcule APRES le recalcul des champs d\'execution', async () => {
      // `result` est reecrit par le bloc comportemental (executionScore/Grade/Method).
      // Un calcul place avant renverrait un objet construit sur des champs perimes :
      // ce test echoue si les deux se croisent.
      const base = withSession(EmotionState.CONFIDENT, null);
      mockPrisma.trade.findUnique
        .mockResolvedValueOnce({ ...base, accountId: 'acc-1', stopLoss: null })
        .mockResolvedValueOnce({
          executionScore: 77,
          executionGrade: 'BON',
          executionMethod: 'BEHAVIORAL',
        });
      mockPrisma.trade.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...base, accountId: 'acc-1', ...data }),
      );

      const res = await service.update('user-123', 'trade-123', { pnl: 500 });

      expect(res.executionScore, 'Champs d\'execution rafraichis').toBe(77);
      expect(res.effectiveEmotion, 'Emotion effective presente sur le meme objet').toBe(
        EmotionState.CONFIDENT,
      );
    });
  });
});
