import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReferralService } from './referral.service';

describe('ReferralService', () => {
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
    referralReward: { findMany: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
    referralCommission: { findMany: ReturnType<typeof vi.fn> };
  };
  let resend: { sendAmbassadorApplication: ReturnType<typeof vi.fn> };
  let stripe: { getCustomerBalanceCreditEur: ReturnType<typeof vi.fn> };
  let service: ReferralService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
      referralReward: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      referralCommission: { findMany: vi.fn().mockResolvedValue([]) },
    };
    resend = { sendAmbassadorApplication: vi.fn().mockResolvedValue(undefined) };
    stripe = { getCustomerBalanceCreditEur: vi.fn().mockResolvedValue(0) };
    service = new ReferralService(prisma as never, resend as never, stripe as never);
  });

  describe('ensureReferralCode', () => {
    it('retourne le code existant sans regénérer', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'GREG', name: 'Greg', email: 'g@x.com' });
      const code = await service.ensureReferralCode('u1');
      expect(code).toBe('GREG');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('génère et persiste un code si absent', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: null, name: 'Maxime', email: 'm@x.com' });
      prisma.user.findUnique.mockResolvedValueOnce({ referralCode: null, name: 'Maxime', email: 'm@x.com' });
      // generateUniqueCode : findUnique({ where: { referralCode }}) → libre
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({});
      const code = await service.ensureReferralCode('u1');
      expect(code).toMatch(/^[A-Z0-9]{3,20}$/);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { referralCode: code } }),
      );
    });
  });

  describe('getMyReferral', () => {
    it('compte les filleuls payants actifs et marque les récompensés', async () => {
      prisma.user.findUnique.mockResolvedValue({ referralCode: 'GREG', name: 'Greg', email: 'g@x.com' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'f1', name: 'Alice', email: 'a@x.com', plan: 'PREMIUM', stripeSubscriptionStatus: 'active', createdAt: new Date() },
        { id: 'f2', name: 'Bob', email: 'b@x.com', plan: 'PREMIUM', stripeSubscriptionStatus: 'trialing', createdAt: new Date() },
        { id: 'f3', name: 'Cara', email: 'c@x.com', plan: 'FREE', stripeSubscriptionStatus: null, createdAt: new Date() },
      ]);
      prisma.referralReward.findMany.mockResolvedValue([{ filleulId: 'f1', status: 'APPLIED' }]);
      stripe.getCustomerBalanceCreditEur.mockResolvedValue(39);

      const r = await service.getMyReferral('u1');

      expect(r.referralCode).toBe('GREG');
      expect(r.invited).toBe(3);
      expect(r.subscribed).toBe(1); // seul f1 (active + payant)
      expect(r.freeMonthsEarned).toBe(1);
      expect(r.creditAvailable).toBe(39);
      const f1 = r.filleuls.find((f) => f.status === 'payant');
      expect(f1?.rewarded).toBe(true);
      expect(r.filleuls[0].pseudo).not.toContain('@'); // pseudo masqué
    });
  });

  describe('getAdminOverview', () => {
    it('exclut démo et ambassadeurs, calcule conversion + mois', async () => {
      prisma.user.findMany
        // 1er appel : liste parrains (where role != AMBASSADOR, isDemo false)
        .mockResolvedValueOnce([
          { id: 'p1', referralCode: 'GREG', name: 'Greg', email: 'g@x.com' },
        ])
        // 2e appel : filleuls récents
        .mockResolvedValueOnce([
          { name: 'Alice', email: 'a@x.com', plan: 'PREMIUM', stripeSubscriptionStatus: 'active', createdAt: new Date(), referredBy: 'GREG' },
        ]);
      prisma.user.groupBy
        .mockResolvedValueOnce([{ referredBy: 'GREG', _count: { _all: 4 } }]) // invités
        .mockResolvedValueOnce([{ referredBy: 'GREG', _count: { _all: 2 } }]); // payants
      prisma.referralReward.groupBy.mockResolvedValue([
        { parrainId: 'p1', status: 'APPLIED', _count: { _all: 1 } },
        { parrainId: 'p1', status: 'PENDING', _count: { _all: 1 } },
      ]);

      const o = await service.getAdminOverview();

      // Vérifie l'exclusion via le where passé à findMany
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ isDemo: false, role: { not: 'AMBASSADOR' } });

      expect(o.parrainsActifs).toBe(1);
      expect(o.invitesTotal).toBe(4);
      expect(o.payants).toBe(2);
      expect(o.tauxConversion).toBe(50);
      expect(o.moisAccordes).toBe(1);
      expect(o.moisAAppliquer).toBe(1);
      expect(o.parrains[0]).toMatchObject({ invited: 4, payants: 2, conversion: 50, moisGagnes: 2, moisAppliques: 1 });
    });
  });

  describe('applyAmbassador', () => {
    it("envoie l'email équipe et ne change PAS le rôle", async () => {
      prisma.user.findUnique.mockResolvedValue({ name: 'Maxime', email: 'm@x.com' });
      const res = await service.applyAmbassador('u1', { socials: 'instagram.com/maxime', message: 'salut' });
      expect(res).toEqual({ success: true });
      expect(resend.sendAmbassadorApplication).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Maxime', email: 'm@x.com', socials: 'instagram.com/maxime' }),
      );
      expect(prisma.user.update).not.toHaveBeenCalled(); // jamais de passage auto
    });
  });
});
