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
    cron = new MetricsSnapshotCron(prisma, users, {} as never, {} as never) // VpsService, RedisService : non utilisés ici;
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

  /**
   * la ligne doit être datée du jour qu'elle DÉCRIT. Avant, le cron de
   * 00h05 comptait 24 h glissantes (donc la veille) et rangeait sous le jour courant,
   * décalant tout le graphe d'un jour.
   */
  describe('takeSnapshot() — fenêtre de comptage des inscrits', () => {
    let userCount: ReturnType<typeof vi.fn>;
    let upsert: ReturnType<typeof vi.fn>;
    let snapCron: MetricsSnapshotCron;

    beforeEach(() => {
      userCount = vi.fn().mockResolvedValue(0);
      upsert = vi.fn().mockImplementation((args) => Promise.resolve({ date: args.where.date, ...args.create }));
      const prisma = {
        metricsSnapshot: { findMany: vi.fn().mockResolvedValue([]), upsert },
        user: { count: userCount },
      } as unknown as PrismaService;
      const users = {
        adminStats: vi.fn().mockResolvedValue({
          mrr: 0, arr: 0, totalUsers: 3, freeUsers: 3, totalPremium: 0,
          trials: 0, betaTesters: 0, ambassadors: 0,
        }),
      } as unknown as UsersService;
      snapCron = new MetricsSnapshotCron(prisma, users, {} as never, {} as never) // VpsService, RedisService : non utilisés ici;
    });

    it('compte les inscrits sur la journée calendaire ciblée, pas sur 24 h glissantes', async () => {
      await snapCron.takeSnapshot('2026-08-07');

      // 2e appel à user.count = les inscrits (le 1er = les actifs 7 jours).
      const where = userCount.mock.calls[1][0].where;
      expect(where.createdAt.gte.toISOString()).toBe('2026-08-06T22:00:00.000Z'); // minuit Paris
      expect(where.createdAt.lt.toISOString()).toBe('2026-08-07T22:00:00.000Z');
      expect(where.isDemo).toBe(false);
    });

    it('date la ligne du jour ciblé, pas du jour où le cron tourne', async () => {
      await snapCron.takeSnapshot('2026-08-07');
      expect(upsert.mock.calls[0][0].where.date).toBe('2026-08-07');
    });

    it('sans argument, photographie aujourd’hui (déclenchement manuel)', async () => {
      const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
      await snapCron.takeSnapshot();
      expect(upsert.mock.calls[0][0].where.date).toBe(today);
    });
  });
});
