import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicCostService } from './anthropic-cost.service';

const mockPrisma = {
  anthropicCostDaily: { upsert: vi.fn(), count: vi.fn() },
} as never;

/** Construit le service avec (ou sans) clé Admin — lue à la construction. */
function makeService(key?: string): AnthropicCostService {
  if (key === undefined) delete process.env['ANTHROPIC_ADMIN_KEY'];
  else process.env['ANTHROPIC_ADMIN_KEY'] = key;
  return new AnthropicCostService(mockPrisma);
}

const okJson = (json: unknown) => ({ ok: true, json: () => Promise.resolve(json) });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['ANTHROPIC_ADMIN_KEY'];
});

describe('AnthropicCostService.fetchCostReport', () => {
  it('ADMIN_KEY absente → [] sans throw, sans appel réseau', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const svc = makeService(undefined);

    const res = await svc.fetchCostReport('a', 'b');

    expect(res).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cents → USD, modèle parsé depuis la description, agrégé par (date, model)', async () => {
    const json = {
      data: [
        {
          starting_at: '2026-06-01T00:00:00Z',
          results: [
            { amount: '3210', description: 'Claude Haiku 4.5 — input tokens' },
            { amount: '664', description: 'Claude Sonnet 4.6 — output tokens' },
            { amount: '100', description: 'Web search request' }, // → other
          ],
        },
      ],
      has_more: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(json)));
    const svc = makeService('sk-ant-admin01-x');

    const res = await svc.fetchCostReport('a', 'b');
    const byModel = Object.fromEntries(res.map((r) => [r.model, r.amountUsd]));

    expect(byModel['claude-haiku-4-5']).toBeCloseTo(32.1);
    expect(byModel['claude-sonnet-4-6']).toBeCloseTo(6.64);
    expect(byModel['other']).toBeCloseTo(1.0);
    expect(res.every((r) => r.date === '2026-06-01')).toBe(true);
  });

  it('distingue les générations : Haiku 5.5 ≠ Haiku 4.5, Sonnet 5.5 ≠ Sonnet 4.6', async () => {
    const json = {
      data: [
        {
          starting_at: '2026-10-08T00:00:00Z',
          results: [
            { amount: '100', description: 'Claude Haiku 4.5 — input tokens' },
            { amount: '200', description: 'Claude Haiku 5.5 — input tokens' },
            { amount: '300', description: 'Claude Haiku 5.5 — output tokens' },
            { amount: '400', description: 'Claude Sonnet 5.5 Usage - Input Tokens' },
            { amount: '500', description: 'Claude Sonnet 4.6 — output tokens' },
            { amount: '600', description: 'Claude Sonnet 5 — input tokens' },
            { amount: '700', description: 'claude-haiku-4-5-20251001 input' },
            { amount: '800', description: 'Claude Opus' },
          ],
        },
      ],
      has_more: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(json)));
    const res = await makeService('sk-ant-admin01-x').fetchCostReport('a', 'b');
    const byModel = Object.fromEntries(res.map((r) => [r.model, r.amountUsd]));

    expect(byModel['claude-haiku-4-5']).toBeCloseTo(8); // 1 + 7 (id daté : la date n'est pas une version)
    expect(byModel['claude-haiku-5-5']).toBeCloseTo(5);
    expect(byModel['claude-sonnet-5-5']).toBeCloseTo(4);
    expect(byModel['claude-sonnet-4-6']).toBeCloseTo(5);
    expect(byModel['claude-sonnet-5']).toBeCloseTo(6);
    expect(byModel['claude-opus']).toBeCloseTo(8);
  });

  it('pagination : suit has_more / next_page', async () => {
    const page1 = { data: [{ starting_at: '2026-06-01T00:00:00Z', results: [{ amount: '100', description: 'haiku' }] }], has_more: true, next_page: 'P2' };
    const page2 = { data: [{ starting_at: '2026-06-02T00:00:00Z', results: [{ amount: '200', description: 'haiku' }] }], has_more: false, next_page: null };
    const fetchSpy = vi.fn().mockResolvedValueOnce(okJson(page1)).mockResolvedValueOnce(okJson(page2));
    vi.stubGlobal('fetch', fetchSpy);
    const svc = makeService('sk-ant-admin01-x');

    const res = await svc.fetchCostReport('a', 'b');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('page=P2');
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.date === '2026-06-02')?.amountUsd).toBeCloseTo(2.0);
  });

  it('réponse non-ok (403) → best-effort, [] sans throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('forbidden') }));
    const svc = makeService('sk-ant-admin01-x');

    await expect(svc.fetchCostReport('a', 'b')).resolves.toEqual([]);
  });

  it('amount manquant/non numérique → ignoré sans crash', async () => {
    const json = { data: [{ starting_at: '2026-06-01T00:00:00Z', results: [{ description: 'haiku' }, { amount: 'x', description: 'haiku' }] }], has_more: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(json)));
    const svc = makeService('sk-ant-admin01-x');

    await expect(svc.fetchCostReport('a', 'b')).resolves.toEqual([]);
  });
});

describe('AnthropicCostService.refreshLast30Days', () => {
  it('upsert chaque (date, model) + renvoie total', async () => {
    const json = { data: [{ starting_at: '2026-06-01T00:00:00Z', results: [{ amount: '500', description: 'haiku' }] }], has_more: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson(json)));
    (mockPrisma as { anthropicCostDaily: { upsert: ReturnType<typeof vi.fn> } }).anthropicCostDaily.upsert.mockResolvedValue({});
    const svc = makeService('sk-ant-admin01-x');

    const res = await svc.refreshLast30Days();

    expect((mockPrisma as { anthropicCostDaily: { upsert: ReturnType<typeof vi.fn> } }).anthropicCostDaily.upsert).toHaveBeenCalledOnce();
    expect(res.rows).toBe(1);
    expect(res.total30d).toBeCloseTo(5.0);
  });

  it('aucune donnée (clé absente) → ne touche pas le cache', async () => {
    const svc = makeService(undefined);

    const res = await svc.refreshLast30Days();

    expect((mockPrisma as { anthropicCostDaily: { upsert: ReturnType<typeof vi.fn> } }).anthropicCostDaily.upsert).not.toHaveBeenCalled();
    expect(res).toEqual({ rows: 0, total30d: 0 });
  });
});