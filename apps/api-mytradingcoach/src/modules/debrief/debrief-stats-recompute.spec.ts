import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics/analytics-summary', () => ({ computeSummary: vi.fn() }));

import { computeSummary } from '../analytics/analytics-summary';
import { changedStatsFields, recomputeDebriefStats, restoreDebriefStats } from './debrief-stats-recompute';

const WEEK = { winRate: 0, totalPnl: -200, totalTrades: 1, maxDrawdown: 200, profitFactor: null, streak: -1, topSession: '-', topSessionWinRate: 0, topHour: '-' };
const HISTORY = { ...WEEK, totalPnl: -150, totalTrades: 3, winRate: 33.33 };
const debrief = (id: string, stats: unknown) => ({
  id, userId: 'u1', startDate: new Date('2026-11-09T00:00:00'), endDate: new Date('2026-11-15T23:59:59.999'), stats,
});

function client(rows: ReturnType<typeof debrief>[]) {
  const calls: string[] = [];
  const prisma = {
    $queryRaw: vi.fn(),
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
    expect(report).toEqual({ lus: 2, modifies: 1, inchanges: 1, champs: { totalPnl: 1, totalTrades: 1, winRate: 1 } });
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
