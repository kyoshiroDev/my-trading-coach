import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics/analytics-summary', () => ({ computeSummary: vi.fn() }));

import { computeSummary } from '../analytics/analytics-summary';
import { changedStatsFields, recomputeDebriefStats, restoreDebriefStats, tradesAtGeneration } from './debrief-stats-recompute';

const WEEK = { winRate: 0, totalPnl: -200, totalTrades: 1, maxDrawdown: 200, profitFactor: null, streak: -1, topSession: '-', topSessionWinRate: 0, topHour: '-' };
const HISTORY = { ...WEEK, totalPnl: -150, totalTrades: 3, winRate: 33.33 };
const sections = (...counts: number[]) => ({ accounts: counts.map((n) => ({ stats: { totalTrades: n } })) });
const debrief = (id: string, stats: unknown, insights: unknown = sections(1)) => ({
  id, userId: 'u1', startDate: new Date('2026-11-09T00:00:00'), endDate: new Date('2026-11-15T23:59:59.999'), stats, insights,
});

function client(rows: ReturnType<typeof debrief>[], weekTrades: Record<string, number> = {}) {
  const calls: string[] = [];
  const prisma = {
    $queryRaw: vi.fn(),
    // Trades clôturés encore présents dans la semaine (1 par défaut).
    trade: { count: vi.fn(async () => weekTrades[rows[0]?.id ?? ''] ?? 1) },
    weeklyDebrief: {
      findMany: vi.fn(async (args: { cursor?: unknown }) => (args.cursor ? [] : rows)),
      update: vi.fn(async ({ where }: { where: { id: string } }) => { calls.push(`update:${where.id}`); }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'gone' ? null : { id: where.id })),
      updateMany: vi.fn(async ({ where }: { where: { id: string } }) => ({ count: where.id === 'gone' ? 0 : 1 })),
    },
  };
  return { prisma, calls };
}

describe('recomputeDebriefStats (#943)', () => {
  beforeEach(() => {
    vi.mocked(computeSummary).mockReset();
    vi.mocked(computeSummary).mockResolvedValue({ ...WEEK, maxDrawdownAccountId: 'acc-1' });
  });

  it('simulation : bilan sans identifiant, aucune écriture, bornes = dates enregistrées, démo exclue', async () => {
    const { prisma } = client([debrief('d1', HISTORY), debrief('d2', WEEK)]);
    const report = await recomputeDebriefStats(prisma as never, { apply: false });
    expect(report).toEqual({
      lus: 2, modifies: 1, inchanges: 1, champs: { totalPnl: 1, totalTrades: 1, winRate: 1 },
      ignores: { tradesSupprimes: 0, formatInconnu: 0 },
    });
    expect(prisma.weeklyDebrief.update).not.toHaveBeenCalled();
    expect(computeSummary).toHaveBeenCalledWith(prisma, {
      userId: 'u1', from: new Date('2026-11-09T00:00:00'), to: new Date('2026-11-15T23:59:59.999'),
    });
    expect(prisma.weeklyDebrief.findMany.mock.calls[0][0]).toMatchObject({ where: { user: { isDemo: false } } });
    expect(JSON.stringify(report)).not.toMatch(/d1|u1/);
  });

  it('écriture : sauvegarde AVANT chaque modification, stats sans id de compte, texte IA non touché', async () => {
    const { prisma, calls } = client([debrief('d1', HISTORY)]);
    const backup = vi.fn((row: { id: string }) => calls.push(`backup:${row.id}`));
    await recomputeDebriefStats(prisma as never, { apply: true, backup });
    expect(calls).toEqual(['backup:d1', 'update:d1']);
    expect(backup).toHaveBeenCalledWith({ id: 'd1', stats: HISTORY });
    expect(prisma.weeklyDebrief.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { stats: WEEK } });
  });

  it('écriture sans sauvegarde : refusée', async () => {
    const { prisma } = client([debrief('d1', HISTORY)]);
    await expect(recomputeDebriefStats(prisma as never, { apply: true })).rejects.toThrow('sauvegarde');
  });

  it('un seul trader avec userId', async () => {
    const { prisma } = client([]);
    await recomputeDebriefStats(prisma as never, { apply: false, userId: 'u9' });
    expect(prisma.weeklyDebrief.findMany.mock.calls[0][0]).toMatchObject({ where: { user: { isDemo: false }, userId: 'u9' } });
  });

  it('pagination par curseur jusqu’au dernier lot', async () => {
    const rows = [debrief('a', WEEK), debrief('b', WEEK)];
    const { prisma } = client([]);
    prisma.weeklyDebrief.findMany = vi.fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([debrief('c', WEEK)]) as never;
    const report = await recomputeDebriefStats(prisma as never, { apply: false, batchSize: 2 });
    expect(report.lus).toBe(3);
    expect(prisma.weeklyDebrief.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: 'b' }, skip: 1 }));
  });
});

describe('semaine sans plus aucun trade (décision du 11/11)', () => {
  beforeEach(() => {
    vi.mocked(computeSummary).mockReset();
    vi.mocked(computeSummary).mockResolvedValue({ ...WEEK, totalTrades: 0, totalPnl: 0, maxDrawdown: 0, maxDrawdownAccountId: null });
  });
  const run = async (insights: unknown, weekTrades: number) => {
    const { prisma } = client([debrief('d1', HISTORY, insights)], { d1: weekTrades });
    const report = await recomputeDebriefStats(prisma as never, { apply: true, backup: vi.fn() });
    return { report, prisma };
  };

  it('trades supprimés depuis la génération : non touché, compté à part', async () => {
    const { report, prisma } = await run(sections(2, 3), 0);
    expect(report).toMatchObject({ lus: 1, modifies: 0, inchanges: 0, ignores: { tradesSupprimes: 1, formatInconnu: 0 } });
    expect(computeSummary).not.toHaveBeenCalled();
    expect(prisma.weeklyDebrief.update).not.toHaveBeenCalled();
  });

  it('ancien format sans sections et semaine vide : non touché, compté à part', async () => {
    const { report, prisma } = await run({ summary: 'ancien' }, 0);
    expect(report.ignores).toEqual({ tradesSupprimes: 0, formatInconnu: 1 });
    expect(prisma.weeklyDebrief.update).not.toHaveBeenCalled();
  });

  it('semaine déjà vide à la génération : recalculée, « 0 trade » est la vraie valeur', async () => {
    const { report, prisma } = await run(sections(0, 0), 0);
    expect(report).toMatchObject({ modifies: 1, ignores: { tradesSupprimes: 0, formatInconnu: 0 } });
    expect(prisma.weeklyDebrief.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stats: expect.objectContaining({ totalTrades: 0 }) } }));
  });

  it('semaine avec encore des trades : recalculée, quel que soit le format', async () => {
    const { report } = await run({ summary: 'ancien' }, 2);
    expect(report).toMatchObject({ modifies: 1, ignores: { tradesSupprimes: 0, formatInconnu: 0 } });
  });

  it('compte les trades clôturés de la semaine, tous comptes', async () => {
    const { prisma } = await run(sections(1), 1);
    expect(prisma.trade.count).toHaveBeenCalledWith({
      where: { userId: 'u1', tradedAt: { gte: new Date('2026-11-09T00:00:00'), lte: new Date('2026-11-15T23:59:59.999') }, pnl: { not: null } },
    });
  });
});

describe('tradesAtGeneration', () => {
  it('somme des sections ; null sans sections ; valeurs illisibles ignorées', () => {
    expect(tradesAtGeneration(sections(2, 3))).toBe(5);
    expect(tradesAtGeneration(sections())).toBe(0);
    expect(tradesAtGeneration({ accounts: [{ stats: {} }, null, { stats: { totalTrades: '4' } }] })).toBe(4);
    expect(tradesAtGeneration({ summary: 'x' })).toBeNull();
    expect(tradesAtGeneration(null)).toBeNull();
    expect(tradesAtGeneration([])).toBeNull();
  });
});

describe('changedStatsFields', () => {
  it('ordre des clés indifférent, clé absente d’un côté comptée', () => {
    expect(changedStatsFields({ b: 1, a: 2 }, { a: 2, b: 1 })).toEqual([]);
    expect(changedStatsFields({ a: 1, old: true }, { a: 1 })).toEqual(['old']);
    expect(changedStatsFields(null, { a: 1 })).toEqual(['a']);
  });
});

describe('restoreDebriefStats', () => {
  it('simulation puis écriture ; débrief supprimé depuis : compté introuvable', async () => {
    const { prisma } = client([]);
    const rows = [{ id: 'd1', stats: HISTORY }, { id: 'gone', stats: {} }];
    expect(await restoreDebriefStats(prisma as never, rows, false)).toEqual({ lignes: 2, restaures: 1, introuvables: 1 });
    expect(prisma.weeklyDebrief.updateMany).not.toHaveBeenCalled();
    expect(await restoreDebriefStats(prisma as never, rows, true)).toEqual({ lignes: 2, restaures: 1, introuvables: 1 });
    expect(prisma.weeklyDebrief.updateMany).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { stats: HISTORY } });
  });
});
