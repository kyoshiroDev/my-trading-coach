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
  const raw = () => (mockPrisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw;
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });

  beforeEach(() => raw().mockReset());

  it('fusionne visites et inscrits par source, direct = null, et calcule les taux', async () => {
    raw()
      .mockResolvedValueOnce([
        { source: 'ninjatrader', d7: 3n, d30: 8n, total: 8n, premium: 2n, trialing: 1n },
        { source: null, d7: 1n, d30: 4n, total: 40n, premium: 4n, trialing: 0n },
      ])
      .mockResolvedValueOnce([
        { source: 'ninjatrader', v7: 40n, v30: 100n },
        { source: '', v7: 10n, v30: 50n },
        { source: 'google.com', v7: 5n, v30: 20n },
      ])
      .mockResolvedValueOnce([{ date: new Date(`${today}T00:00:00Z`), visits: 7n, pageviews: 12n }])
      .mockResolvedValueOnce([{ path: '/', visits: 150n, pageviews: 300n }]);

    const res = await service.getAcquisition();

    expect(res.rows.map((r) => r.source)).toEqual(['ninjatrader', null, 'google.com']);
    expect(res.rows[0]).toEqual({
      source: 'ninjatrader', visits7d: 40, visits30d: 100, signups7d: 3, signups30d: 8, signupsTotal: 8,
      premium: 2, trialing: 1, visitToSignupRate: 8, conversionRate: 25,
    });
    // Source vue en visites mais sans inscrit : présente, à zéro.
    expect(res.rows[2]).toMatchObject({ visits30d: 20, signupsTotal: 0, visitToSignupRate: 0 });
    expect(res.totals).toMatchObject({ visits30d: 170, signups30d: 12, premium: 6, visitToSignupRate: 7.1, conversionRate: 12.5 });
    // 30 jours complets, aujourd'hui en dernier.
    expect(res.daily).toHaveLength(30);
    expect(res.daily[29]).toEqual({ date: today, visits: 7, pageviews: 12 });
    expect(res.daily[0]).toMatchObject({ visits: 0, pageviews: 0 });
    expect(res.totals.pageviews30d).toBe(12);
    expect(res.topPages).toEqual([{ path: '/', visits: 150, pageviews: 300 }]);
  });

  it('le taux global ignore les inscrits des sources sans visite landing', async () => {
    raw()
      .mockResolvedValueOnce([
        { source: 'x.com', d7: 1n, d30: 1n, total: 1n, premium: 0n, trialing: 0n },
        { source: null, d7: 1n, d30: 1n, total: 10n, premium: 0n, trialing: 0n },
      ])
      .mockResolvedValueOnce([{ source: 'x.com', v7: 1n, v30: 1n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const res = await service.getAcquisition();
    expect(res.totals.visitToSignupRate).toBe(100);
  });

  it('détaille par source + medium + campagne et additionne au niveau source', async () => {
    raw()
      .mockResolvedValueOnce([
        { source: 'instagram', medium: 'bio', campaign: null, d7: 1n, d30: 2n, total: 2n, premium: 1n, trialing: 0n },
        { source: 'instagram', medium: 'story', campaign: 'lancement', d7: 0n, d30: 1n, total: 1n, premium: 0n, trialing: 0n },
      ])
      .mockResolvedValueOnce([
        { source: 'instagram', medium: 'bio', campaign: '', v7: 10n, v30: 40n },
        { source: 'instagram', medium: 'story', campaign: 'lancement', v7: 5n, v30: 10n },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await service.getAcquisition();

    // Niveau source : bio + story.
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ source: 'instagram', visits30d: 50, signups30d: 3, signupsTotal: 3, premium: 1 });
    // Niveau détail : '' (visites) et null (inscrits) fusionnés en une seule ligne « bio ».
    expect(res.campaigns.map((c) => [c.source, c.medium, c.campaign])).toEqual([
      ['instagram', 'bio', null],
      ['instagram', 'story', 'lancement'],
    ]);
    expect(res.campaigns[0]).toMatchObject({ visits30d: 40, signups30d: 2, visitToSignupRate: 5, conversionRate: 50 });
    expect(res.campaigns[1]).toMatchObject({ visits30d: 10, signups30d: 1, visitToSignupRate: 10 });
  });

  it('renvoie des totaux à zéro sans donnée', async () => {
    raw().mockResolvedValue([]);
    const res = await service.getAcquisition();
    expect(res.rows).toEqual([]);
    expect(res.totals.conversionRate).toBe(0);
    expect(res.daily.every((d) => d.visits === 0)).toBe(true);
  });
});
