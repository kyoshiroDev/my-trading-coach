import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletedAccountService } from './deleted-account.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DeletedAccountService', () => {
  let service: DeletedAccountService;
  let updateMany: ReturnType<typeof vi.fn>;
  let findMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateMany = vi.fn().mockResolvedValue({ count: 2 });
    findMany = vi.fn();
    const prisma = { deletedAccount: { updateMany, findMany } } as unknown as PrismaService;
    service = new DeletedAccountService(prisma);
  });

  describe('anonymizeOld()', () => {
    it('cible deletedAt < now-90j et anonymizedAt null, vide name/email', async () => {
      const count = await service.anonymizeOld();
      expect(count).toBe(2);
      const arg = updateMany.mock.calls[0][0];
      expect(arg.where.anonymizedAt).toBeNull();
      expect(arg.where.deletedAt.lt).toBeInstanceOf(Date);
      // seuil ~90 jours dans le passé
      const ageDays = (Date.now() - arg.where.deletedAt.lt.getTime()) / 86_400_000;
      expect(Math.round(ageDays)).toBe(90);
      expect(arg.data).toMatchObject({ name: null, email: null });
      expect(arg.data.anonymizedAt).toBeInstanceOf(Date);
    });
  });

  describe('getDeletedAccounts()', () => {
    it('calcule les agrégats (médiane, % sans trade, motifs)', async () => {
      const now = Date.now();
      findMany.mockResolvedValue([
        { deletedAt: new Date(now), lifetimeDays: 1, hadTraded: false, reason: null },
        { deletedAt: new Date(now), lifetimeDays: 4, hadTraded: false, reason: 'Trop compliqué' },
        { deletedAt: new Date(now), lifetimeDays: 16, hadTraded: true, reason: 'Pas pour moi' },
      ]);

      const res = await service.getDeletedAccounts();

      expect(res.stats.total).toBe(3);
      expect(res.stats.medianLifetimeDays).toBe(4); // trié [1,4,16] → médiane 4
      expect(res.stats.noTradeCount).toBe(2);
      expect(res.stats.noTradePct).toBe(67); // 2/3
      expect(res.byMonth).toHaveLength(6);
      const reasons = Object.fromEntries(res.byReason.map((r) => [r.reason, r.count]));
      expect(reasons['Non renseigné']).toBe(1);
      expect(reasons['Trop compliqué']).toBe(1);
    });

    it('liste vide → agrégats à zéro sans crash', async () => {
      findMany.mockResolvedValue([]);
      const res = await service.getDeletedAccounts();
      expect(res.stats).toMatchObject({ total: 0, medianLifetimeDays: 0, noTradePct: 0 });
      expect(res.byMonth).toHaveLength(6);
      expect(res.byReason).toEqual([]);
    });
  });
});