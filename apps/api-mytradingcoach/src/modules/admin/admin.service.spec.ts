import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminService } from './admin.service';

const mockPrisma = {
  anthropicCostDaily: { findMany: vi.fn() },
  aiUsageLog: { aggregate: vi.fn(), groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
} as never;

const service = new AdminService(
  mockPrisma,
  {} as never, // UsersService — non utilisé par getAiCost
  {} as never, // StripeSubscriptionService
);

const today = new Date().toISOString().slice(0, 10);

describe('AdminService.getAiCost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const p = mockPrisma as {
      anthropicCostDaily: { findMany: ReturnType<typeof vi.fn> };
      aiUsageLog: { aggregate: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
      user: { findMany: ReturnType<typeof vi.fn> };
    };
    // RÉEL (Cost API cache) : 32.10 Haiku + 6.64 Sonnet = 38.74.
    p.anthropicCostDaily.findMany.mockResolvedValue([
      { date: today, model: 'claude-haiku-4-5', amountUsd: 32.1, updatedAt: new Date() },
      { date: today, model: 'claude-sonnet-4-6', amountUsd: 6.64, updatedAt: new Date() },
    ]);
    // ESTIMÉ (logs) : total attribué 19.30.
    p.aiUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 19.3 } });
    p.aiUsageLog.groupBy
      .mockResolvedValueOnce([
        { feature: 'news_translation', _sum: { costUsd: 13.7 } },
        { feature: 'chat', _sum: { costUsd: 1.54 } },
      ])
      .mockResolvedValueOnce([
        { userId: 'u1', _count: 62, _sum: { inputTokens: 40000, outputTokens: 1800, costUsd: 0.71 } },
      ]);
    p.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.c', name: 'SBIRED' }]);
  });

  it('billed = somme Cost API, byModel pct sur le total réel', async () => {
    const res = await service.getAiCost();
    expect(res.billed.total30d).toBeCloseTo(38.74);
    const haiku = res.billed.byModel.find((m) => m.model.includes('haiku'))!;
    expect(haiku.pct).toBe(83); // 32.10 / 38.74 ≈ 82.9 → 83
    expect(res.billed.daily).toHaveLength(30);
    expect(res.billed.updatedAt).not.toBeNull();
  });

  it('attributed = somme logs, byFeature pct sur le total attribué', async () => {
    const res = await service.getAiCost();
    expect(res.attributed.total30d).toBeCloseTo(19.3);
    const news = res.attributed.byFeature.find((f) => f.feature === 'news_translation')!;
    expect(news.pct).toBe(71); // 13.70 / 19.30 ≈ 71
    expect(res.attributed.topUsers[0]).toMatchObject({ name: 'SBIRED', calls: 62, cost: 0.71 });
  });

  it('unattributed = max(0, billed - attributed)', async () => {
    const res = await service.getAiCost();
    expect(res.unattributed).toBeCloseTo(38.74 - 19.3); // 19.44
  });

  it('attribué > réel (réel non encore rafraîchi) → unattributed = 0', async () => {
    (mockPrisma as { anthropicCostDaily: { findMany: ReturnType<typeof vi.fn> } }).anthropicCostDaily.findMany.mockResolvedValue([]);
    const res = await service.getAiCost();
    expect(res.billed.total30d).toBe(0);
    expect(res.billed.updatedAt).toBeNull();
    expect(res.unattributed).toBe(0);
  });
});
describe('AdminService.getAcquisition', () => {
  it('convertit les compteurs SQL, garde null pour « direct » et calcule les totaux', async () => {
    (mockPrisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValue([
      { source: 'ninjatrader', d7: 3n, d30: 8n, total: 8n, premium: 2n, trialing: 1n },
      { source: null, d7: 1n, d30: 4n, total: 40n, premium: 4n, trialing: 0n },
    ]);

    const res = await service.getAcquisition();

    expect(res.rows[0]).toEqual({
      source: 'ninjatrader', signups7d: 3, signups30d: 8, signupsTotal: 8,
      premium: 2, trialing: 1, conversionRate: 25,
    });
    expect(res.rows[1].source).toBeNull();
    expect(res.rows[1].conversionRate).toBe(10);
    expect(res.totals).toEqual({
      signups7d: 4, signups30d: 12, signupsTotal: 48, premium: 6, trialing: 1, conversionRate: 12.5,
    });
  });

  it('renvoie des totaux à zéro sans inscrit', async () => {
    (mockPrisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw.mockResolvedValue([]);
    const res = await service.getAcquisition();
    expect(res.rows).toEqual([]);
    expect(res.totals.conversionRate).toBe(0);
  });
});
