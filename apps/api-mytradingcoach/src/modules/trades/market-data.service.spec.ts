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

  it('ne traduit QUE les titres (max_tokens 1200, corps jamais envoyé) et persiste titleFr', async () => {
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
    expect(params.max_tokens).toBe(1200);
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

  it('30 titres → 3 lots de 10 ; un lot tronqué ou décalé n’empêche pas les autres', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, title: `Title ${i}` }));
    prisma.marketNews.findMany.mockResolvedValueOnce(rows);
    const ok = (from: number) => ({
      content: [{ type: 'text', text: JSON.stringify(rows.slice(from, from + 10).map((r) => ({ title: `Titre ${r.id}` }))) }],
    });
    anthropicClient.create
      .mockResolvedValueOnce(ok(0))
      // JSON tronqué, comme en prod le 06/10 (« Unterminated string »)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '[{"title":"Titre n10"},{"title":"Titre n1' }] })
      .mockResolvedValueOnce(ok(20));

    const count = await svc.refreshNewsBatch();

    expect(anthropicClient.create).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(anthropicClient.create.mock.calls[0][0])).not.toContain('Title 10');
    expect(count).toBe(20);
    const ids = prisma.marketNews.update.mock.calls.map((c: [{ where: { id: string } }]) => c[0].where.id);
    expect(ids).toContain('n0');
    expect(ids).toContain('n29');
    expect(ids).not.toContain('n15'); // lot illisible : reste à traduire au prochain passage
  });

  it('réponse avec un titre en moins : lot ignoré plutôt que traductions décalées', async () => {
    const { svc, prisma, anthropicClient } = makeService();
    prisma.marketNews.findMany.mockResolvedValueOnce([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    anthropicClient.create.mockResolvedValueOnce({ content: [{ type: 'text', text: '[{"title":"Titre A"}]' }] });

    expect(await svc.refreshNewsBatch()).toBe(0);
    expect(prisma.marketNews.update).not.toHaveBeenCalled();
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

describe('MarketDataService — une seule traduction IA par news (SCA-B3-05)', () => {
  function setup(create: ReturnType<typeof vi.fn>) {
    const store = new Map<string, string>();
    const redisService = { client: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string, ...a: unknown[]) => (a.includes('NX') && store.has(k) ? null : (store.set(k, v), 'OK'))),
      del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    } };
    let row = { id: 'n1', text: 'Fed holds rates', textFr: null as string | null, textTranslated: false };
    const prisma = { marketNews: {
      findUnique: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: { data: { textFr: string } }) => { row = { ...row, textFr: data.textFr, textTranslated: true }; return row; }),
    } };
    const config = { get: vi.fn((k: string) => (k === 'NEWS_TRANSLATION' ? 'true' : k === 'NODE_ENV' ? 'production' : undefined)) };
    const svc = new MarketDataService(config as never, redisService as never, prisma as never, { create } as never);
    Object.defineProperty(svc, 'translationEnabled', { get: () => true });
    return svc;
  }

  it('30 ouvertures simultanées d’une news → 1 seul appel IA, tous reçoivent la traduction', async () => {
    const create = vi.fn(async () => { await new Promise((r) => setTimeout(r, 30)); return { content: [{ type: 'text', text: 'La Fed maintient ses taux' }] }; });
    const svc = setup(create);
    const texts = await Promise.all(Array.from({ length: 30 }, () => svc.ensureNewsTextFr('n1')));
    expect(create).toHaveBeenCalledTimes(1);
    expect(texts.every((t) => t === 'La Fed maintient ses taux')).toBe(true);
  });

  it('IA en échec → 1 seul appel, les autres reçoivent le texte d’origine sans relancer l’IA', async () => {
    const create = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error('529 overloaded'); });
    const svc = setup(create);
    const texts = await Promise.all(Array.from({ length: 10 }, () => svc.ensureNewsTextFr('n1')));
    expect(create).toHaveBeenCalledTimes(1);
    expect(texts.every((t) => t === 'Fed holds rates')).toBe(true);
  });
});

describe('MarketDataService — sources et filtre des news', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('interroge chaque flux ; news générales rangées sous MACRO, date lue en heure de New York', async () => {
    const { svc, prisma } = makeService();
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes('general-latest')
        ? [{ url: 'u1', title: 'Fed holds rates', publishedDate: '2026-10-06 15:35:49' }]
        : []),
    }));
    vi.stubGlobal('fetch', fetch);

    await svc.refreshNewsBatch();

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.some((c: unknown[]) => String(c[0]).includes('/news/general-latest?limit=20&apikey='))).toBe(true);
    expect(prisma.marketNews.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ symbol: 'MACRO', publishedDate: new Date('2026-10-06T19:35:49Z') }),
    }));
  });

  it('un flux en erreur n’empêche pas les autres', async () => {
    const { svc, prisma } = makeService();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.includes('forex')
      ? Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve([{ url: url, symbol: 'SPY', title: 't', publishedDate: '2026-10-06 10:00:00' }]) })));

    await svc.refreshNewsBatch();

    expect(prisma.marketNews.upsert).toHaveBeenCalledTimes(3);
  });

  it('actifs du journal (MNQ) → news QQQ + macro ; rien trouvé → toutes les news', async () => {
    const { svc, prisma } = makeService();
    prisma.marketNews.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'x', title: 'T', symbol: 'SPY', publishedDate: new Date(), textTranslated: false },
    ]);

    const items = await svc.getNews('MNQ');

    expect(prisma.marketNews.findMany.mock.calls[0][0].where).toEqual({ symbol: { in: ['MACRO', 'QQQ'] } });
    expect(prisma.marketNews.findMany.mock.calls[1][0].where).toEqual({});
    expect(items).toHaveLength(1);
  });
});
