import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { EcoCalendarService } from './eco-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

const mockPrisma = {
  trade: { findMany: vi.fn() },
};

const mockAi = {
  analyzeEcoEvents: vi.fn(),
  analyzeEcoResult: vi.fn(),
};

describe('EcoCalendarService', () => {
  let service: EcoCalendarService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        EcoCalendarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAi },
      ],
    }).compile();

    service = module.get(EcoCalendarService);
    // Spy sur les méthodes Redis — même pattern que session.service.spec.ts
    vi.spyOn(service['redis'], 'get').mockResolvedValue(null);
    vi.spyOn(service['redis'], 'setex').mockResolvedValue('OK' as never);
    vi.spyOn(service['redis'], 'quit').mockResolvedValue('OK' as never);
  });

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
    expect(mockPrisma.trade.findMany).not.toHaveBeenCalled();
  });

  it('getUserTopAssets retourne les 5 actifs les plus tradés', async () => {
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
    expect(assets[0]).toBe('GC');     // 4 occurrences → 1er
    expect(assets[1]).toBe('NQ');     // 3 occurrences → 2ème
    expect(assets[2]).toBe('BTC/USDT'); // 2 occurrences → 3ème
  });

  it('analyzeReleasedEvent retourne null si aucun cache', async () => {
    vi.spyOn(service['redis'], 'get').mockResolvedValue(null);

    const result = await service.analyzeReleasedEvent('user-1', 'PMI Zone Euro');

    expect(result).toBeNull();
    expect(mockAi.analyzeEcoResult).not.toHaveBeenCalled();
  });

  it('analyzeReleasedEvent retourne null si event non publié', async () => {
    const cached = {
      events: [{ name: 'PMI Zone Euro', impact: 'high', isReleased: false, actual: null }],
      analysis: {},
      userAssets: ['NQ'],
    };
    vi.spyOn(service['redis'], 'get').mockResolvedValue(JSON.stringify(cached));

    const result = await service.analyzeReleasedEvent('user-1', 'PMI Zone Euro');

    expect(result).toBeNull();
    expect(mockAi.analyzeEcoResult).not.toHaveBeenCalled();
  });

  it('analyzeReleasedEvent appelle analyzeEcoResult pour un event publié', async () => {
    const event = {
      name: 'PMI Zone Euro',
      impact: 'high',
      isReleased: true,
      actual: 52.1,
      estimate: 51.0,
      previous: 50.5,
    };
    const cached = { events: [event], analysis: {}, userAssets: ['EUR/USD'] };
    vi.spyOn(service['redis'], 'get').mockResolvedValue(JSON.stringify(cached));
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

  it('fetchEconomicEvents retourne un tableau vide si API key absente', async () => {
    const originalKey = process.env['FINANCIAL_MODELING_PREP_API_KEY'];
    delete process.env['FINANCIAL_MODELING_PREP_API_KEY'];

    const events = await service.fetchEconomicEvents('2026-05-23');

    expect(events).toEqual([]);
    if (originalKey) process.env['FINANCIAL_MODELING_PREP_API_KEY'] = originalKey;
  });
});
