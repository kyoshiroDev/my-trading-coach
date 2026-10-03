import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarketDataService } from './market-data.service';

function makeService() {
  const config = { get: vi.fn().mockReturnValue('fmp-key') } as any;
  const redisService = {
    client: {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue('OK'),
    },
  } as any;
  const prisma = {
    marketNews: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as any;
  const anthropicClient = { create: vi.fn() } as any;
  const svc = new MarketDataService(config, redisService, prisma, anthropicClient);
  return { svc, config, redisService, prisma, anthropicClient };
}

describe('MarketDataService — refreshNewsBatch (titres uniquement)', () => {
  let origEnv: string | undefined;
  beforeEach(() => {
    origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production'; // translationEnabled
    delete process.env['NEWS_TRANSLATION'];
    // Pas d'appel réseau : FMP renvoie une liste vide → on teste juste la traduction des titres.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) }));
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env['NODE_ENV'] = origEnv;
    else delete process.env['NODE_ENV'];
    vi.unstubAllGlobals();
  });

  it('ne traduit QUE les titres (max_tokens 800, corps jamais envoyé) et persiste titleFr', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    prisma.marketNews.findMany.mockResolvedValueOnce([
      { id: 'n1', title: 'Apple soars on earnings', text: 'A very long article body that must NOT be translated' },
    ]);
    anthropicClient.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: '[{"title":"Apple bondit sur ses résultats"}]' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const count = await svc.refreshNewsBatch();

    expect(count).toBe(1);
    expect(anthropicClient.create).toHaveBeenCalledOnce();
    const [params, meta] = anthropicClient.create.mock.calls[0];
    expect(params.max_tokens).toBe(800);
    expect(meta).toEqual({ feature: 'news_translation', userId: null });
    // Le corps de l'article ne doit jamais partir au modèle.
    expect(JSON.stringify(params)).toContain('Apple soars on earnings');
    expect(JSON.stringify(params)).not.toContain('long article body');
    // Persistance : titleFr + translated, sans toucher au texte.
    expect(prisma.marketNews.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { titleFr: 'Apple bondit sur ses résultats', translated: true },
    });
    const persisted = prisma.marketNews.update.mock.calls[0][0].data;
    expect(persisted).not.toHaveProperty('textFr');
    expect(persisted).not.toHaveProperty('textTranslated');
  });
});

describe('MarketDataService — ensureNewsTextFr (lazy)', () => {
  let origEnv: string | undefined;
  beforeEach(() => {
    origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['NEWS_TRANSLATION'];
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env['NODE_ENV'] = origEnv;
    else delete process.env['NODE_ENV'];
  });

  it('no-op si déjà traduit → renvoie textFr, AUCUN appel modèle', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    prisma.marketNews.findUnique.mockResolvedValueOnce({
      id: 'n1', textTranslated: true, textFr: 'Corps FR', text: 'EN body',
    });

    const res = await svc.ensureNewsTextFr('n1');

    expect(res).toBe('Corps FR');
    expect(anthropicClient.create).not.toHaveBeenCalled();
    expect(prisma.marketNews.update).not.toHaveBeenCalled();
  });

  it('no-op si pas de texte (text == null) → AUCUN appel modèle', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    prisma.marketNews.findUnique.mockResolvedValueOnce({
      id: 'n2', textTranslated: false, textFr: null, text: null,
    });

    const res = await svc.ensureNewsTextFr('n2');

    expect(res).toBeNull();
    expect(anthropicClient.create).not.toHaveBeenCalled();
  });

  it('traduit + persiste (max_tokens 700) à la 1re ouverture', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    prisma.marketNews.findUnique.mockResolvedValueOnce({
      id: 'n3', textTranslated: false, textFr: null, text: 'English article body',
    });
    anthropicClient.create.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Corps de l’article en français' }],
      usage: { input_tokens: 50, output_tokens: 40 },
    });

    const res = await svc.ensureNewsTextFr('n3');

    expect(res).toBe('Corps de l’article en français');
    expect(anthropicClient.create).toHaveBeenCalledOnce();
    const [params, meta] = anthropicClient.create.mock.calls[0];
    expect(params.max_tokens).toBe(700);
    expect(meta).toEqual({ feature: 'news_translation', userId: null });
    expect(prisma.marketNews.update).toHaveBeenCalledWith({
      where: { id: 'n3' },
      data: { textFr: 'Corps de l’article en français', textTranslated: true },
    });
  });
});

describe('MarketDataService — single-flight du contexte marché (SCA-B3-04)', () => {
  it('50 ouvertures simultanées sur un cache vide → 4 appels sortants (1 par fournisseur), pas 200', async () => {
    const store = new Map<string, string>();
    const redisService = {
      client: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        set: vi.fn(async (k: string, v: string, ...args: unknown[]) => (args.includes('NX') && store.has(k) ? null : (store.set(k, v), 'OK'))),
        setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK'; }),
        del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      },
    };
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 100, previousClose: 99 } }] } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const config = { get: vi.fn((k: string) => (k === 'FMP_API_KEY' ? 'test-key' : undefined)) };
    const svc = new MarketDataService(config as never, redisService as never, {} as never, {} as never);

    const results = await Promise.all(Array.from({ length: 50 }, () => svc.getMarketContext()));

    expect(fetchMock).toHaveBeenCalledTimes(4); // NQ, S&P 500, DXY, taux US
    expect(results.every((r) => r.nq.value === 100)).toBe(true);
    vi.unstubAllGlobals();
  });
});
