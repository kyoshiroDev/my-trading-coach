import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { EcoCalendarService } from './eco-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { RedisService } from '../shared/redis.service';
import { todayParis } from '../../common/utils/paris-date';

const mockPrisma = {
  trade: { findMany: vi.fn() },
  ecoEvent: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  ecoAnalysisCache: {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  },
};

const mockAi = {
  analyzeEcoEvents: vi.fn(),
  analyzeEcoResult: vi.fn(),
};

const makeFmpEvent = (overrides: Partial<{
  date: string; event: string; country: string; currency: string;
  previous: number | null; estimate: number | null; actual: number | null;
  change: number | null; changePercentage: number | null; impact: string; unit: string;
}> = {}) => ({
  date: '2026-05-26 13:30:00',
  event: 'NFP',
  country: 'US',
  currency: 'USD',
  previous: 150000,
  estimate: 180000,
  actual: null,
  change: null,
  changePercentage: null,
  impact: 'High',
  unit: 'K',
  ...overrides,
});


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
    quit: vi.fn().mockResolvedValue('OK'),
  },
};
describe('EcoCalendarService', () => {
  let service: EcoCalendarService;
  let originalFmpKey: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        { provide: RedisService, useValue: mockRedisService },
        EcoCalendarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAi },
      ],
    }).compile();

    service = module.get(EcoCalendarService);
    vi.spyOn(service['redis'], 'get').mockResolvedValue(null);
    vi.spyOn(service['redis'], 'setex').mockResolvedValue('OK' as never);

    // Valeur par défaut : user sans pins
    mockPrisma.user.findUnique.mockResolvedValue({ pinnedEcoEvents: [] });
    mockPrisma.user.update.mockResolvedValue({});
    // Cache analyse mutualisée : miss par défaut
    mockPrisma.ecoAnalysisCache.findUnique.mockResolvedValue(null);
    mockPrisma.ecoAnalysisCache.upsert.mockResolvedValue({});

    originalFmpKey = process.env['FMP_API_KEY'];
  });

  afterEach(() => {
    if (originalFmpKey !== undefined) {
      process.env['FMP_API_KEY'] = originalFmpKey;
    } else {
      delete process.env['FMP_API_KEY'];
    }
    vi.restoreAllMocks();
  });

  // ── fetchAndStoreEvents ───────────────────────────────────────────────────

  describe('fetchAndStoreEvents', () => {
    it('retourne [] et logue une erreur si FMP_API_KEY absente', async () => {
      delete process.env['FMP_API_KEY'];
      const logSpy = vi.spyOn(service['logger'], 'error');

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(result).toEqual([]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('FMP_API_KEY'));
    });

    it('retourne [] et logue une erreur sur HTTP 402', async () => {
      process.env['FMP_API_KEY'] = 'test-key';
      const logSpy = vi.spyOn(service['logger'], 'error');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        json: vi.fn(),
      }));

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(result).toEqual([]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('402'));
    });

    it('retourne [] sur autre erreur HTTP', async () => {
      process.env['FMP_API_KEY'] = 'test-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        json: vi.fn(),
      }));

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(result).toEqual([]);
    });

    it('filtre les événements Low impact', async () => {
      process.env['FMP_API_KEY'] = 'test-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue([
          makeFmpEvent({ impact: 'High' }),
          makeFmpEvent({ event: 'Holiday Notice', impact: 'Low' }),
          makeFmpEvent({ event: 'PMI Flash', impact: 'Medium', currency: 'EUR' }),
        ]),
      }));
      mockPrisma.ecoEvent.upsert.mockImplementation(({ create }) => Promise.resolve({ ...create, id: 'id-1' }));

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.impact === 'high' || e.impact === 'medium')).toBe(true);
      expect(mockPrisma.ecoEvent.upsert).toHaveBeenCalledTimes(2);
    });

    it('convertit le time UTC en heure Paris', async () => {
      process.env['FMP_API_KEY'] = 'test-key';
      // 13:30 UTC = 15:30 Paris (CEST +2)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue([
          makeFmpEvent({ date: '2026-05-26 13:30:00', impact: 'High' }),
        ]),
      }));
      mockPrisma.ecoEvent.upsert.mockImplementation(({ create }) => Promise.resolve({ ...create, id: 'id-1' }));

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(result[0].time).toBe('15:30');
    });

    it('upserte correctement un event existant (actual mis à jour)', async () => {
      process.env['FMP_API_KEY'] = 'test-key';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue([
          makeFmpEvent({ actual: 210000 }),
        ]),
      }));
      mockPrisma.ecoEvent.upsert.mockResolvedValue({
        id: 'id-1', date: '2026-05-26', time: '15:30', name: 'NFP',
        country: 'US', currency: 'USD', impact: 'high',
        actual: 210000, estimate: 180000, previous: 150000,
        isReleased: true, unit: 'K',
      });

      const result = await service.fetchAndStoreEvents('2026-05-26');

      expect(mockPrisma.ecoEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ actual: 210000, isReleased: true }),
        }),
      );
      expect(result[0].isReleased).toBe(true);
      expect(result[0].actual).toBe(210000);
    });
  });

  // ── getEventsFromDb ───────────────────────────────────────────────────────

  describe('getEventsFromDb', () => {
    it('retourne les events triés et mappés depuis la BDD', async () => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([
        {
          time: '09:30', name: 'CPI', country: 'US', currency: 'USD',
          impact: 'high', actual: null, estimate: 3.2, previous: 3.1,
          isReleased: false, unit: '%',
        },
      ]);

      const result = await service.getEventsFromDb('2026-05-26');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('CPI');
      expect(result[0].impact).toBe('high');
      expect(mockPrisma.ecoEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { date: '2026-05-26' }, orderBy: { time: 'asc' } }),
      );
    });
  });

  // ── checkNewReleases ──────────────────────────────────────────────────────

  describe('checkNewReleases', () => {
    // Ligne BDD complète telle que lue par getEventsFromDb (date passée → isReleased
    // dynamique = actual !== null). nameFr null → name reste l'anglais en test.
    const dbRow = (actual: number | null) => ({
      date: '2026-05-26', time: '15:30', name: 'NFP', nameFr: null,
      country: 'US', currency: 'USD', impact: 'high',
      actual, estimate: 180000, previous: 150000, isReleased: actual !== null, unit: 'K',
    });

    it('détecte un event nouvellement publié', async () => {
      mockPrisma.ecoEvent.findMany
        .mockResolvedValueOnce([dbRow(null)])      // avant : pas encore publié
        .mockResolvedValueOnce([dbRow(210000)]);   // après : publié
      const fetchSpy = vi.spyOn(service, 'fetchAndStoreEvents').mockResolvedValue([]);

      const { hasNew, newEvents } = await service.checkNewReleases('2026-05-26');

      expect(hasNew).toBe(true);
      expect(newEvents).toHaveLength(1);
      expect(newEvents[0].name).toBe('NFP');
      expect(fetchSpy).toHaveBeenCalledWith('2026-05-26');
    });

    it('ne re-détecte pas un event déjà released', async () => {
      mockPrisma.ecoEvent.findMany
        .mockResolvedValueOnce([dbRow(210000)])    // avant : déjà publié
        .mockResolvedValueOnce([dbRow(210000)]);   // après : toujours publié
      vi.spyOn(service, 'fetchAndStoreEvents').mockResolvedValue([]);

      const { hasNew, newEvents } = await service.checkNewReleases('2026-05-26');

      expect(hasNew).toBe(false);
      expect(newEvents).toHaveLength(0);
    });

    it('retourne hasNew false si aucun event published', async () => {
      mockPrisma.ecoEvent.findMany
        .mockResolvedValueOnce([dbRow(null)])
        .mockResolvedValueOnce([dbRow(null)]);
      vi.spyOn(service, 'fetchAndStoreEvents').mockResolvedValue([]);

      const { hasNew, newEvents } = await service.checkNewReleases('2026-05-26');

      expect(hasNew).toBe(false);
      expect(newEvents).toHaveLength(0);
    });
  });

  // ── Sélection quotidienne (reset paresseux) ───────────────────────────────

  describe('getUserPins / updateUserPins (sélection quotidienne)', () => {
    it('même jour (Paris) → renvoie les pins, pas de reset', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ pinnedEcoEvents: ['NFP:USD'], pinnedEcoDate: todayParis() });
      expect(await service.getUserPins('u1')).toEqual(['NFP:USD']);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('date périmée → renvoie vide + reset paresseux en base', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ pinnedEcoEvents: ['NFP:USD'], pinnedEcoDate: '2020-01-01' });
      expect(await service.getUserPins('u1')).toEqual([]);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pinnedEcoEvents: [], pinnedEcoDate: null } }),
      );
    });

    it('jamais sélectionné (date null, vide) → vide sans écriture inutile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ pinnedEcoEvents: [], pinnedEcoDate: null });
      expect(await service.getUserPins('u1')).toEqual([]);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('updateUserPins enregistre la date du jour (Paris)', async () => {
      await service.updateUserPins('u1', ['NFP:USD']);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pinnedEcoEvents: ['NFP:USD'], pinnedEcoDate: todayParis() } }),
      );
    });
  });

  // ── analyzeReleasedEvent (cache IA) ───────────────────────────────────────

  describe('analyzeReleasedEvent (cache IA result)', () => {
    const released = {
      date: '2026-05-26', time: '15:30', name: 'NFP', nameFr: null,
      country: 'US', currency: 'USD', impact: 'high',
      actual: 210000, estimate: 180000, previous: 150000, isReleased: true, unit: 'K',
    };
    const analysis = { interpretation: 'Surprise haussière', assetSentiments: [] };

    beforeEach(() => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([released]);
      mockPrisma.trade.findMany.mockResolvedValue([]); // getUserTopAssets → []
      mockAi.analyzeEcoResult.mockResolvedValue(analysis);
    });

    it('cache miss → appelle le modèle puis met en cache (setex)', async () => {
      const r = await service.analyzeReleasedEvent('user-1', 'NFP');
      expect(r).toEqual(analysis);
      expect(mockAi.analyzeEcoResult).toHaveBeenCalledTimes(1);
      expect(service['redis'].setex).toHaveBeenCalledWith(
        expect.stringMatching(/^eco:analysis:.*:NFP:/),
        expect.any(Number),
        JSON.stringify(analysis),
      );
    });

    it('cache hit → ne rappelle PAS le modèle', async () => {
      vi.spyOn(service['redis'], 'get').mockImplementation(
        ((key: string) =>
          Promise.resolve(key.startsWith('eco:analysis:') ? JSON.stringify(analysis) : null)) as never,
      );
      const r = await service.analyzeReleasedEvent('user-1', 'NFP');
      expect(r).toEqual(analysis);
      expect(mockAi.analyzeEcoResult).not.toHaveBeenCalled();
    });
  });

  // ── getTodayEvents ────────────────────────────────────────────────────────

  describe('getTodayEvents', () => {
    it('retourne les données depuis le cache Redis si disponible', async () => {
      const cached = {
        events: [{ name: 'PMI', impact: 'high', isReleased: false }],
        analysis: { summary: 'Journée chargée.', recommendation: 'Évite EUR.', assetImpacts: [] },
        userAssets: ['NQ'],
      };
      vi.spyOn(service['redis'], 'get').mockResolvedValue(JSON.stringify(cached));

      const result = await service.getTodayEvents('user-1');

      expect(result).toEqual(cached);
      expect(mockAi.analyzeEcoEvents).not.toHaveBeenCalled();
    });

    it('retourne analyse par défaut si aucun event en BDD', async () => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([]);
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const result = await service.getTodayEvents('user-1');

      expect(result.events).toHaveLength(0);
      expect(result.analysis.summary).toContain('Aucun événement');
      expect(mockAi.analyzeEcoEvents).not.toHaveBeenCalled();
    });

    it('appelle analyzeEcoEvents quand des events sont présents', async () => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([{
        time: '15:30', name: 'NFP', country: 'US', currency: 'USD',
        impact: 'high', actual: null, estimate: 180000, previous: 150000,
        isReleased: false, unit: 'K',
      }]);
      mockPrisma.trade.findMany.mockResolvedValue([{ asset: 'NQ' }]);
      mockAi.analyzeEcoEvents.mockResolvedValue({
        summary: 'NFP attendu.', recommendation: 'Attention 15h30.', assetImpacts: [],
      });

      const result = await service.getTodayEvents('user-1');

      expect(mockAi.analyzeEcoEvents).toHaveBeenCalledOnce();
      expect(result.analysis.summary).toContain('NFP');
    });

    it('mutualise l’analyse : 2 users mêmes actifs → 1 seul appel IA (le 2e lit le cache BDD)', async () => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([{
        time: '15:30', name: 'NFP', country: 'US', currency: 'USD',
        impact: 'high', actual: null, estimate: 180000, previous: 150000,
        isReleased: false, unit: 'K',
      }]);
      mockPrisma.trade.findMany.mockResolvedValue([{ asset: 'NQ' }]); // même actif pour les 2
      const analysis = { summary: 'NFP attendu.', recommendation: '', assetImpacts: [] };
      mockAi.analyzeEcoEvents.mockResolvedValue(analysis);
      mockPrisma.ecoAnalysisCache.findUnique
        .mockResolvedValueOnce(null) // user-A : cache BDD miss → appel IA
        .mockResolvedValueOnce({ analysisJson: JSON.stringify(analysis) }); // user-B : hit

      await service.getTodayEvents('user-A');
      await service.getTodayEvents('user-B');

      expect(mockAi.analyzeEcoEvents).toHaveBeenCalledOnce();
      expect(mockPrisma.ecoAnalysisCache.upsert).toHaveBeenCalledOnce();
    });
  });

  describe('assetsKey', () => {
    it('normalise (trim, upper, dédup, tri) et renvoie DEFAULT si vide', () => {
      const key = (a: string[]) => service['assetsKey'](a);
      expect(key(['  btc ', 'eth', 'BTC'])).toBe('BTC|ETH');
      expect(key([])).toBe('DEFAULT');
      expect(key(['', '  '])).toBe('DEFAULT');
    });
  });

  // ── getUserTopAssets ──────────────────────────────────────────────────────

  describe('getUserTopAssets', () => {
    it('retourne les 5 actifs les plus tradés', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([
        { asset: 'NQ' }, { asset: 'NQ' }, { asset: 'NQ' },
        { asset: 'BTC/USDT' }, { asset: 'BTC/USDT' },
        { asset: 'EUR/USD' },
        { asset: 'GC' }, { asset: 'GC' }, { asset: 'GC' }, { asset: 'GC' },
        { asset: 'CL' },
        { asset: 'ES' },
      ]);

      const assets = await service.getUserTopAssets('user-1');

      expect(assets).toHaveLength(5);
      expect(assets[0]).toBe('GC');
      expect(assets[1]).toBe('NQ');
      expect(assets[2]).toBe('BTC/USDT');
    });
  });

  // ── analyzeReleasedEvent ──────────────────────────────────────────────────

  describe('analyzeReleasedEvent', () => {
    it('retourne null si event introuvable (cache vide → fallback BDD vide)', async () => {
      vi.spyOn(service['redis'], 'get').mockResolvedValue(null);
      mockPrisma.ecoEvent.findMany.mockResolvedValue([]); // fallback BDD : aucun event

      const result = await service.analyzeReleasedEvent('user-1', 'PMI Zone Euro');

      expect(result).toBeNull();
    });

    it('retourne null si event non encore publié', async () => {
      const cached = {
        events: [{ name: 'PMI Zone Euro', isReleased: false, actual: null }],
        analysis: {},
        userAssets: ['NQ'],
      };
      vi.spyOn(service['redis'], 'get').mockResolvedValue(JSON.stringify(cached));

      const result = await service.analyzeReleasedEvent('user-1', 'PMI Zone Euro');

      expect(result).toBeNull();
    });

    it('appelle analyzeEcoResult pour un event publié', async () => {
      const event = {
        name: 'PMI Zone Euro', impact: 'high', isReleased: true,
        actual: 52.1, estimate: 51.0, previous: 50.5,
      };
      const cached = { events: [event], analysis: {}, userAssets: ['EUR/USD'] };
      // cache calendrier = hit (events) ; cache d'analyse IA = miss → le modèle est appelé
      vi.spyOn(service['redis'], 'get').mockImplementation(
        ((key: string) =>
          Promise.resolve(key.startsWith('eco:analysis:') ? null : JSON.stringify(cached))) as never,
      );
      mockPrisma.trade.findMany.mockResolvedValue([{ asset: 'EUR/USD' }]);
      mockAi.analyzeEcoResult.mockResolvedValue({
        interpretation: 'PMI supérieur aux attentes — signal haussier EUR.',
        assetSentiments: [{ asset: 'EUR/USD', sentiment: 'bull', shortReason: 'PMI surprise positive' }],
      });

      const result = await service.analyzeReleasedEvent('user-1', 'PMI Zone Euro');

      expect(mockAi.analyzeEcoResult).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', event }),
      );
      expect(result?.interpretation).toContain('PMI');
    });
  });

  // ── getNextTradingDay ─────────────────────────────────────────────────────

  describe('getNextTradingDay', () => {
    it('retourne le lendemain pour un lundi', () => {
      const monday = new Date('2026-05-25T12:00:00Z');
      expect(service.getNextTradingDay(monday).toISOString().slice(0, 10)).toBe('2026-05-26');
    });

    it('saute le week-end du vendredi → lundi', () => {
      const friday = new Date('2026-05-22T12:00:00Z');
      expect(service.getNextTradingDay(friday).toISOString().slice(0, 10)).toBe('2026-05-25');
    });

    it('saute le week-end du samedi → lundi', () => {
      const saturday = new Date('2026-05-23T12:00:00Z');
      expect(service.getNextTradingDay(saturday).toISOString().slice(0, 10)).toBe('2026-05-25');
    });
  });

  // ── isWeekend ─────────────────────────────────────────────────────────────

  describe('isWeekend', () => {
    it('retourne true pour un samedi', () => {
      expect(service.isWeekend(new Date('2026-05-23T12:00:00Z'))).toBe(true);
    });

    it('retourne true pour un dimanche', () => {
      expect(service.isWeekend(new Date('2026-05-24T12:00:00Z'))).toBe(true);
    });

    it('retourne false pour un lundi', () => {
      expect(service.isWeekend(new Date('2026-05-25T12:00:00Z'))).toBe(false);
    });
  });

  // ── getTomorrowEvents ─────────────────────────────────────────────────────

  describe('getTomorrowEvents', () => {
    it('utilise le cache Redis si disponible', async () => {
      const cached = {
        events: [{ name: 'NFP', impact: 'high', isReleased: false }],
        analysis: { summary: 'Journée NFP.', recommendation: '', assetImpacts: [] },
        userAssets: ['NQ'],
      };
      vi.spyOn(service['redis'], 'get').mockResolvedValue(JSON.stringify(cached));

      const result = await service.getTomorrowEvents('user-1');

      expect(result).toEqual(cached);
      expect(mockAi.analyzeEcoEvents).not.toHaveBeenCalled();
    });

    it('lit les events BDD pour le prochain jour ouvré', async () => {
      mockPrisma.ecoEvent.findMany.mockResolvedValue([]);
      mockPrisma.trade.findMany.mockResolvedValue([]);

      await service.getTomorrowEvents('user-1');

      expect(mockPrisma.ecoEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } }),
      );
      const calledDate = new Date(
        (mockPrisma.ecoEvent.findMany.mock.calls[0][0] as { where: { date: string } }).where.date,
      );
      expect(calledDate.getDay()).not.toBe(0);
      expect(calledDate.getDay()).not.toBe(6);
    });
  });
});
