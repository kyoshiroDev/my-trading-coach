import { describe, it, expect, vi } from 'vitest';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';

// MRR sur le montant RÉELLEMENT payé (#525) : base (fondateur, partenaire, normal) et Stripe
// (après remise). La réconciliation ne doit plus afficher d'écart pour ces comptes.

const now = new Date();
const monthsAgo = (n: number) => new Date(now.getTime() - n * 31 * 86_400_000);

const PAYING = [
  { stripeInterval: 'month', founderSeat: null, partnerRedemption: null }, // 49
  { stripeInterval: 'year', founderSeat: null, partnerRedemption: null }, // 490/12
  { stripeInterval: 'month', founderSeat: { status: 'ACTIVE' }, partnerRedemption: null }, // 29
  { stripeInterval: 'year', founderSeat: { status: 'ACTIVE' }, partnerRedemption: null }, // 290/12
  { // LOUIS29 à vie : 29
    stripeInterval: 'month', founderSeat: null,
    partnerRedemption: { status: 'ACTIVE', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, createdAt: monthsAgo(2) },
  },
  { // 3 mois écoulés : retour au prix normal (49), compté en « normal »
    stripeInterval: 'month', founderSeat: null,
    partnerRedemption: { status: 'ACTIVE', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 3, createdAt: monthsAgo(5) },
  },
];

function usersService() {
  const prisma = {
    user: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue(PAYING) },
    deletedAccount: { count: vi.fn().mockResolvedValue(0) },
  };
  return new UsersService(prisma as never, {} as never);
}

describe('MRR base : montant réellement payé', () => {
  it('découpe normal / fondateur / partenaires', async () => {
    const stats = await usersService().adminStats();
    expect(stats.mrrBreakdown).toEqual({
      normal: Math.round(49 + 490 / 12 + 49),
      founder: Math.round(29 + 290 / 12),
      partner: 29,
    });
    expect(stats.mrr).toBe(stats.mrrBreakdown.normal + stats.mrrBreakdown.founder + stats.mrrBreakdown.partner);
  });
});

describe('MRR Stripe : après remise, sans écart avec la base', () => {
  const sub = (id: string, amount: number, interval: 'month' | 'year', discounts: unknown[] = []) => ({
    id, customer: 'cus', status: 'active', discounts,
    items: { data: [{ quantity: 1, price: { unit_amount: amount, recurring: { interval } } }] },
  });

  it('fondateur 29 €, LOUIS29 (−20 €), annuel partenaire (−200 €) → même MRR que la base', async () => {
    const subs = [
      sub('s1', 2900, 'month'),
      sub('s2', 4900, 'month', [{ coupon: { amount_off: 2000 } }]), // API 2024-06-20
      sub('s3', 49000, 'year', [{ source: { coupon: { amount_off: 20000 } } }]), // forme récente
    ];
    const users = { adminStats: vi.fn().mockResolvedValue({ mrr: Math.round(29 + 29 + 290 / 12) }) };
    const prisma = { user: { findMany: vi.fn().mockResolvedValue([]) } };
    const admin = new AdminService(prisma as never, users as never, { listActiveSubscriptions: vi.fn().mockResolvedValue(subs) } as never);
    const res = await admin.reconcileStripe();
    expect(res.mrrStripe).toBe(Math.round(29 + 29 + 290 / 12));
    expect(res.gap).toBe(0);
  });
});
