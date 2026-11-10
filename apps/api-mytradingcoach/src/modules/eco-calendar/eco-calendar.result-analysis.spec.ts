import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EcoCalendarService } from './eco-calendar.service';
import { AiService } from '../ai/ai.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';
import type { AnthropicClientService } from '../infra/anthropic-client.service';
import type { EcoEvent } from '@mtc/shared';

/**
 * Analyse d'un résultat publié (étape 2, #920) : une génération par (jour, événement, signature),
 * plafond quotidien, nouvel essai après échec, rien hors production. Redis en mémoire (verrous et
 * expirations sur l'horloge figée), modèle simulé : aucun appel réel.
 */
function inMemoryRedis() {
  const store = new Map<string, { v: string; exp: number | null }>();
  const sets = new Map<string, Set<string>>();
  const alive = (k: string) => {
    const e = store.get(k);
    if (e && e.exp !== null && e.exp <= Date.now()) store.delete(k);
    return store.get(k);
  };
  return {
    store,
    get: vi.fn(async (k: string) => alive(k)?.v ?? null),
    set: vi.fn(async (k: string, v: string, _ex: 'EX', s: number, nx?: 'NX') => {
      if (nx && alive(k)) return null;
      store.set(k, { v, exp: Date.now() + s * 1000 });
      return 'OK';
    }),
    setex: vi.fn(async (k: string, s: number, v: string) => {
      store.set(k, { v, exp: Date.now() + s * 1000 });
      return 'OK';
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    incr: vi.fn(async (k: string) => {
      const n = Number(alive(k)?.v ?? 0) + 1;
      store.set(k, { v: String(n), exp: store.get(k)?.exp ?? null });
      return n;
    }),
    expire: vi.fn(async () => 1),
    sadd: vi.fn(async (k: string, m: string) => {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(m);
      return 1;
    }),
    smembers: vi.fn(async (k: string) => [...(sets.get(k) ?? [])]),
  };
}

const DAY = '2026-11-04';
const nfp: EcoEvent = {
  time: '14:30', name: 'Non Farm Payrolls', impact: 'high', country: 'US', currency: 'USD',
  actual: 210, estimate: 180, previous: 150, isReleased: true, unit: 'K',
};
const analysis = { interpretation: 'Contenu de test à ne jamais journaliser', gap: 'above' as const };

describe('EcoCalendarService · analyse des résultats publiés', () => {
  let redis: ReturnType<typeof inMemoryRedis>;
  let ai: { analyzeEcoResult: ReturnType<typeof vi.fn> };
  let service: EcoCalendarService;

  beforeEach(() => {
    // Horloge figée (Date seule : les attentes de verrou gardent de vrais délais courts).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T13:30:30Z'));
    vi.stubEnv('NODE_ENV', 'production');
    redis = inMemoryRedis();
    ai = { analyzeEcoResult: vi.fn(async () => analysis) };
    service = new EcoCalendarService(
      {} as PrismaService,
      ai as unknown as AiService,
      { client: redis } as unknown as RedisService,
      {} as AnthropicClientService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('50 traders de la même signature en même temps : un seul appel modèle, tous servis', async () => {
    ai.analyzeEcoResult.mockImplementation(() => new Promise((r) => setTimeout(() => r(analysis), 50)));
    const results = await Promise.all(
      Array.from({ length: 50 }, () => service.ensureReleasedAnalysis(DAY, nfp, ['nq', 'ES'], 'clic')),
    );
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r?.interpretation === analysis.interpretation)).toBe(true);
    // Même clé que l'analyse au clic d'avant : (jour, nom sans période, actifs triés).
    expect(redis.store.has(`eco:analysis:v2:${DAY}:Non Farm Payrolls:ES,NQ`)).toBe(true);
  });

  it('actifs bruts (clic) et normalisés (auto) : une seule clé, un seul appel', async () => {
    await service.ensureReleasedAnalysis(DAY, nfp, [' nq', 'ES', 'NQ', ''], 'clic');
    await service.ensureReleasedAnalysis(DAY, nfp, ['ES', 'NQ'], 'auto');
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(1);
  });

  it('compte démo : sa signature ne déclenche aucune génération automatique', async () => {
    const svc = service as unknown as {
      getEventsFromDb: () => Promise<EcoEvent[]>;
      getUserTopAssets: () => Promise<string[]>;
    };
    vi.spyOn(svc, 'getEventsFromDb').mockResolvedValue([nfp]);
    vi.spyOn(svc, 'getUserTopAssets').mockResolvedValue(['NQ']);
    await service.analyzeReleasedEvent('demo-user', 'Non Farm Payrolls', true);
    expect(await redis.smembers(`eco:sigs:${DAY}`)).toEqual([]);
    await service.analyzeReleasedEvent('user-1', 'Non Farm Payrolls', false);
    expect(await redis.smembers(`eco:sigs:${DAY}`)).toEqual([JSON.stringify(['NQ'])]);
  });

  it('génération auto puis clic : le clic réutilise le cache, aucun second appel', async () => {
    await redis.sadd(`eco:sigs:${DAY}`, JSON.stringify(['ES', 'NQ']));
    expect(await service.autoAnalyzeReleased(DAY, [nfp])).toBe(1);
    await service.ensureReleasedAnalysis(DAY, nfp, ['NQ', 'ES'], 'clic');
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(1);
  });

  it("échec du modèle : repli null, pas de relance pendant 10 min, nouvel essai ensuite", async () => {
    ai.analyzeEcoResult.mockRejectedValueOnce(new Error('panne'));
    expect(await service.ensureReleasedAnalysis(DAY, nfp, ['NQ'], 'auto')).toBeNull();
    expect(await service.ensureReleasedAnalysis(DAY, nfp, ['NQ'], 'clic')).toBeNull();
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-04T13:40:31Z'));
    expect(await service.ensureReleasedAnalysis(DAY, nfp, ['NQ'], 'clic')).toEqual(analysis);
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(2);
  });

  it('plafond quotidien configurable : au-delà, aucun appel', async () => {
    vi.stubEnv('ECO_RESULT_ANALYSIS_DAILY_MAX', '1');
    await service.ensureReleasedAnalysis(DAY, nfp, ['NQ'], 'auto');
    expect(await service.ensureReleasedAnalysis(DAY, nfp, ['BTC'], 'auto')).toBeNull();
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(1);
  });

  it('compteur dans les journaux, jamais le contenu', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await service.ensureReleasedAnalysis(DAY, nfp, ['NQ'], 'auto');
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /générée \(auto, 2026-11-04, 1\/200\)/.test(l))).toBe(true);
    expect(lines.join('\n')).not.toContain(analysis.interpretation);
  });

  it('auto : seulement les annonces fortes chiffrées publiées (ni moyen, ni discours, ni sans résultat)', async () => {
    await redis.sadd(`eco:sigs:${DAY}`, JSON.stringify(['NQ']));
    await service.autoAnalyzeReleased(DAY, [
      { ...nfp, impact: 'medium', name: 'ISM Services PMI' },
      { ...nfp, name: 'Fed Chair Powell Speech', actual: null, isReleased: false },
      { ...nfp, name: 'CPI YoY', actual: null, isReleased: false },
    ]);
    expect(ai.analyzeEcoResult).not.toHaveBeenCalled();
  });

  it('auto : signatures vues aujourd’hui et hier, une génération chacune', async () => {
    await redis.sadd(`eco:sigs:${DAY}`, JSON.stringify(['NQ']));
    await redis.sadd('eco:sigs:2026-11-03', JSON.stringify(['BTC']));
    await redis.sadd('eco:sigs:2026-11-03', JSON.stringify(['NQ']));
    expect(await service.autoAnalyzeReleased(DAY, [nfp])).toBe(2);
    expect(ai.analyzeEcoResult).toHaveBeenCalledTimes(2);
  });

  it('hors production : aucune génération automatique (comportement actuel conservé)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await redis.sadd(`eco:sigs:${DAY}`, JSON.stringify(['NQ']));
    expect(await service.autoAnalyzeReleased(DAY, [nfp])).toBe(0);
    expect(ai.analyzeEcoResult).not.toHaveBeenCalled();
  });

  it('résultat absent : aucun appel avec une valeur inventée', async () => {
    expect(await service.ensureReleasedAnalysis(DAY, { ...nfp, actual: null }, ['NQ'], 'clic')).toBeNull();
    expect(ai.analyzeEcoResult).not.toHaveBeenCalled();
  });
});

describe('AiService.analyzeEcoResult · valeurs absentes', () => {
  let create: ReturnType<typeof vi.fn>;
  let ai: AiService;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    create = vi.fn(async () => ({
      content: [{ type: 'text', text: '{"interpretation":"Résultat publié."}' }],
    }));
    ai = new AiService(
      {} as PrismaService,
      {} as never,
      {} as never,
      { create } as unknown as AnthropicClientService,
      {} as RedisService,
    );
  });

  afterEach(() => vi.unstubAllEnvs());

  const promptOf = () => String((create.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content);

  it('prévision absente : « pas de consensus », aucune surprise calculée, aucun 0 inventé', async () => {
    await ai.analyzeEcoResult({
      userId: null,
      event: { name: 'Retail Sales MoM', actual: 0.4, estimate: null, previous: 0.2 },
      userAssets: ['NQ'],
    });
    const prompt = promptOf();
    expect(prompt).toContain('pas de consensus');
    expect(prompt).not.toMatch(/Prévision : 0\b/);
    expect(prompt).not.toMatch(/au-dessus|en dessous|en ligne/);
  });

  it('prévision connue : écart calculé en code, transmis au modèle et renvoyé', async () => {
    const r = await ai.analyzeEcoResult({
      userId: null,
      event: { name: 'CPI YoY', actual: 3.1, estimate: 2.9, previous: 3 },
      userAssets: ['NQ'],
    });
    expect(promptOf()).toContain('Écart (calculé) : au-dessus de la prévision');
    expect(r).toEqual({ interpretation: 'Résultat publié.', gap: 'above' });
  });

  it('résultat absent : rejet, aucun appel modèle', async () => {
    await expect(ai.analyzeEcoResult({
      userId: null,
      event: { name: 'CPI YoY', actual: null, estimate: 2.9, previous: 3 },
      userAssets: ['NQ'],
    })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('hors production : aucun appel modèle', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await ai.analyzeEcoResult({
      userId: null,
      event: { name: 'CPI YoY', actual: 3.1, estimate: 2.9, previous: 3 },
      userAssets: ['NQ'],
    });
    expect(create).not.toHaveBeenCalled();
  });
});
