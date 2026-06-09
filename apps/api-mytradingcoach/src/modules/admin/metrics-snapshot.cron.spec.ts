import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsSnapshotCron } from './metrics-snapshot.cron';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';

// Snapshots renvoyés par Prisma : ordre décroissant par date (orderBy date desc).
const SNAPS_DESC = [
  { date: '2026-06-03', totalUsers: 13, mrr: 79, arr: 948 },
  { date: '2026-06-02', totalUsers: 12, mrr: 0, arr: 0 },
  { date: '2026-06-01', totalUsers: 11, mrr: 0, arr: 0 },
];

describe('MetricsSnapshotCron', () => {
  let cron: MetricsSnapshotCron;
  let findMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([...SNAPS_DESC]);
    const prisma = { metricsSnapshot: { findMany } } as unknown as PrismaService;
    const users = {} as UsersService;
    cron = new MetricsSnapshotCron(prisma, users);
  });

  describe('history()', () => {
    it('renvoie les snapshots du plus ancien au plus récent', async () => {
      const rows = await cron.history(30);
      expect(rows.map((r) => r.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    });

    it('borne le nombre de jours : défaut 30, min 1, max 365', async () => {
      await cron.history(NaN);
      expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 30 }));
      await cron.history(0);
      expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
      await cron.history(1000);
      expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 365 }));
      await cron.history(30);
      expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 30 }));
    });
  });

  describe('historyPoints()', () => {
    it('mappe vers {date, users, mrr} dans l’ordre chronologique', async () => {
      const points = await cron.historyPoints(30);
      expect(points).toEqual([
        { date: '2026-06-01', users: 11, mrr: 0 },
        { date: '2026-06-02', users: 12, mrr: 0 },
        { date: '2026-06-03', users: 13, mrr: 79 },
      ]);
    });
  });
});
