/**
 * PROMPT-176 — le RÔLE est la seule vérité pour « être ambassadeur ».
 *
 * `User.referralCode` est partagé entre le parrainage ambassadeur (commission 20 %)
 * et le parrainage grand public (mois offert) : un USER qui génère son code en a un
 * SANS être ambassadeur. Tout filtre basé sur la présence d'un code est donc faux.
 *
 * Ce module n'avait aucun spec, c'est pour ça que le bug est passé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmbassadorService } from './ambassador.service';

describe('AmbassadorService', () => {
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
    referralCommission: { updateMany: ReturnType<typeof vi.fn> };
  };
  let service: AmbassadorService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      referralCommission: { updateMany: vi.fn() },
    };
    service = new AmbassadorService(prisma as never);
  });

  describe('listAmbassadors — filtre sur le rôle, jamais sur la présence d\'un code', () => {
    it('interroge Prisma sur role AMBASSADOR uniquement', async () => {
      await service.listAmbassadors();

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ role: 'AMBASSADOR' });
      // Le filtre ne doit plus contenir de branche « a un code ».
      expect(JSON.stringify(where)).not.toContain('referralCode');
    });

    it('un USER porteur d\'un code de parrainage n\'apparaît pas', async () => {
      // Prisma filtre en amont : avec le bon `where`, la requête ne le renvoie pas.
      // On vérifie donc que le service ne va pas le rechercher par ailleurs.
      prisma.user.findMany.mockResolvedValue([]);

      const list = await service.listAmbassadors();

      expect(list).toEqual([]);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: 'AMBASSADOR' });
    });

    it('un AMBASSADOR apparaît, avec ses compteurs', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'amb-1',
          name: 'Val',
          email: 'val@x.com',
          referralCode: 'VAL',
          referrals: [
            { amount: 9.8, status: 'pending', referredUserId: 'f1' },
            { amount: 9.8, status: 'paid', referredUserId: 'f2' },
          ],
        },
      ]);
      prisma.user.groupBy
        .mockResolvedValueOnce([{ referredBy: 'VAL', _count: { _all: 2 } }])
        .mockResolvedValueOnce([{ referredBy: 'VAL', _count: { _all: 1 } }]);

      const list = await service.listAmbassadors();

      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: 'amb-1',
        referralCode: 'VAL',
        totalReferrals: 2,
        premiumReferrals: 1,
        totalEarned: 19.6,
        pendingPayout: 9.8,
      });
    });

    it('le comptage ne porte que sur les lignes retournées (donc les AMBASSADOR)', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'a1', name: null, email: 'a1@x.com', referralCode: 'A1', referrals: [] },
        { id: 'a2', name: null, email: 'a2@x.com', referralCode: 'A2', referrals: [] },
      ]);

      const list = await service.listAmbassadors();

      // La carte « AMBASSADEURS : n » du back-office compte ces lignes.
      expect(list).toHaveLength(2);
    });
  });

  describe('promote — un ambassadeur a TOUJOURS un code', () => {
    it('génère un code quand l\'utilisateur n\'en a pas (cas VAL)', async () => {
      prisma.user.findUnique
        // 1) lookup de l'utilisateur à promouvoir : pas de code
        .mockResolvedValueOnce({ id: 'u1', name: 'Val', email: 'val@x.com', referralCode: null })
        // 2) generateUniqueCode : le candidat est libre
        .mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({
        email: 'val@x.com',
        name: 'Val',
        role: 'AMBASSADOR',
        referralCode: 'VAL',
      });

      const res = await service.promote('val@x.com');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'AMBASSADOR', referralCode: expect.any(String) }),
        }),
      );
      expect(res.referralCode).toBe('VAL');
      expect(res.referralLink).toContain('?ref=VAL');
    });

    it('réutilise le code existant plutôt que d\'en générer un nouveau', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'u1',
        name: 'Greg',
        email: 'g@x.com',
        referralCode: 'DEJAVU',
      });
      prisma.user.update.mockResolvedValue({
        email: 'g@x.com',
        name: 'Greg',
        role: 'AMBASSADOR',
        referralCode: 'DEJAVU',
      });

      const res = await service.promote('g@x.com');

      expect(res.referralCode).toBe('DEJAVU');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ referralCode: 'DEJAVU' }),
        }),
      );
    });

    it('refuse un code déjà pris par quelqu\'un d\'autre', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1', name: 'A', email: 'a@x.com', referralCode: null })
        .mockResolvedValueOnce({ id: 'autre' }); // le code demandé appartient à un autre

      await expect(service.promote('a@x.com', 'PRIS')).rejects.toThrow(/déjà utilisé/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('revoke — la rétrogradation vide le code', () => {
    it('repasse en USER et met le code à null', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ email: 'a@x.com', name: 'A', role: 'USER' });

      await service.revoke('a@x.com');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'USER', referralCode: null } }),
      );
    });
  });
});