import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PartnerCodeService } from './partner-code.service';

const LOUIS29 = {
  id: 'pc1', code: 'LOUIS29', label: 'Louis (formation)', priceMonthlyEur: 29, priceAnnualEur: 290,
  durationMonths: null, maxRedemptions: 10, expiresAt: new Date('2026-12-31T23:59:59Z'), active: true,
  stripeCouponMonthlyId: 'mtc-partner-2000-forever', stripeCouponAnnualId: 'mtc-partner-20000-forever',
};

function setup(over: {
  code?: object | null; used?: number; reserved?: number; user?: object | null; redemption?: object | null; seat?: object | null;
} = {}) {
  const code = over.code === null ? null : { ...LOUIS29, ...over.code };
  const prisma = {
    partnerCode: {
      findUnique: vi.fn().mockResolvedValue(code),
      create: vi.fn(async ({ data }) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ data }) => ({ ...code, ...data })),
    },
    partnerRedemption: {
      count: vi.fn().mockResolvedValue(over.used ?? 0),
      findUnique: vi.fn().mockResolvedValue(over.redemption ?? null),
      update: vi.fn(async ({ data }) => data),
    },
    checkoutReservation: { count: vi.fn().mockResolvedValue(over.reserved ?? 0) },
    founderSeat: { findUnique: vi.fn().mockResolvedValue(over.seat ?? null) },
    user: {
      findUnique: vi.fn().mockResolvedValue(
        over.user === null ? null : { role: 'USER', isDemo: false, stripeSubscriptionId: null, subscriptionCanceledAt: null, ...over.user },
      ),
    },
  };
  const stripe = {
    coupons: {
      retrieve: vi.fn().mockRejectedValue(new Error('No such coupon')),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const service = new PartnerCodeService(prisma as never, stripe as never);
  return { service, prisma, stripe };
}

const now = new Date('2026-10-08T12:00:00Z');

describe('validate : chaque refus a sa raison', () => {
  it('LOUIS29 valide : conditions, sans nom du partenaire ni nombre d’utilisations', async () => {
    const res = await setup().service.validate('louis29', null, now);
    expect(res).toEqual({
      valid: true, code: 'LOUIS29', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null,
      label: '29 €/mois ou 290 €/an, à vie',
    });
    expect(JSON.stringify(res)).not.toContain('Louis (formation)');
  });

  it.each([
    ['not_found', { code: null }],
    ['inactive', { code: { active: false } }],
    ['expired', { code: { expiresAt: new Date('2026-10-01T00:00:00Z') } }],
    ['exhausted', { used: 9, reserved: 1 }],
  ] as const)('%s', async (reason, over) => {
    const res = await setup(over as never).service.validate('LOUIS29', null, now);
    expect(res).toMatchObject({ valid: false, reason });
  });

  it('quota illimité : jamais épuisé', async () => {
    expect((await setup({ code: { maxRedemptions: null }, used: 5000 }).service.validate('LOUIS29', null, now)).valid).toBe(true);
  });

  it('une utilisation par personne, jamais abonnée, jamais fondateur, pas démo', async () => {
    expect(await setup({ redemption: { id: 'r' } }).service.validate('LOUIS29', 'u1', now)).toMatchObject({ reason: 'already_used' });
    expect(await setup({ user: { stripeSubscriptionId: 'sub' } }).service.validate('LOUIS29', 'u1', now)).toMatchObject({ reason: 'subscribed' });
    expect(await setup({ user: { subscriptionCanceledAt: new Date() } }).service.validate('LOUIS29', 'u1', now)).toMatchObject({ reason: 'subscribed' });
    expect(await setup({ seat: { status: 'LOST' } }).service.validate('LOUIS29', 'u1', now)).toMatchObject({ reason: 'subscribed' });
    expect(await setup({ user: { isDemo: true } }).service.validate('LOUIS29', 'u1', now)).toMatchObject({ reason: 'excluded' });
    expect((await setup().service.validate('LOUIS29', 'u1', now)).valid).toBe(true);
  });
});

describe('admin : coupons Stripe créés par l’API', () => {
  it('création : 2 coupons amount_off EUR (−20 € et −200 €), à vie = forever', async () => {
    const { service, stripe, prisma } = setup({ code: null });
    await service.create({
      code: 'louis29', label: 'Louis', priceMonthlyEur: 29, priceAnnualEur: 290,
      durationMonths: null, maxRedemptions: 10, expiresAt: null,
    });
    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mtc-partner-2000-forever', amount_off: 2000, currency: 'eur', duration: 'forever',
    }));
    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mtc-partner-20000-forever', amount_off: 20000, currency: 'eur', duration: 'forever',
    }));
    expect(prisma.partnerCode.create.mock.calls[0][0].data).toMatchObject({
      code: 'LOUIS29', stripeCouponMonthlyId: 'mtc-partner-2000-forever', stripeCouponAnnualId: 'mtc-partner-20000-forever',
    });
  });

  it('N mois : coupon repeating avec duration_in_months', async () => {
    const { service, stripe } = setup({ code: null });
    await service.create({
      code: 'TRIO', label: 'Trio', priceMonthlyEur: 29, priceAnnualEur: 290,
      durationMonths: 3, maxRedemptions: null, expiresAt: null,
    });
    expect(stripe.coupons.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'mtc-partner-2000-3', duration: 'repeating', duration_in_months: 3,
    }));
  });

  it('coupon déjà existant : réutilisé, pas recréé', async () => {
    const { service, stripe } = setup({ code: null });
    stripe.coupons.retrieve.mockResolvedValue({ id: 'x' });
    await service.create({
      code: 'BIS29', label: 'Bis', priceMonthlyEur: 29, priceAnnualEur: 290,
      durationMonths: null, maxRedemptions: null, expiresAt: null,
    });
    expect(stripe.coupons.create).not.toHaveBeenCalled();
  });

  it('prix hors bornes (0 € ou ≥ prix normal) ou code mal formé → refus', async () => {
    const { service } = setup({ code: null });
    const base = { code: 'OK29', label: 'x', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, maxRedemptions: null, expiresAt: null };
    await expect(service.create({ ...base, priceMonthlyEur: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...base, priceAnnualEur: 490 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...base, code: 'a b' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('code existant → conflit', async () => {
    await expect(setup().service.create({
      code: 'LOUIS29', label: 'x', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, maxRedemptions: null, expiresAt: null,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('modification du prix → NOUVEAUX coupons pour les futurs abonnés ; libellé seul → mêmes coupons', async () => {
    const priced = setup();
    await priced.service.update('pc1', { priceMonthlyEur: 25, priceAnnualEur: 250 });
    expect(priced.prisma.partnerCode.update.mock.calls[0][0].data).toMatchObject({
      stripeCouponMonthlyId: 'mtc-partner-2400-forever', stripeCouponAnnualId: 'mtc-partner-24000-forever',
    });
    const label = setup();
    await label.service.update('pc1', { label: 'Louis V2', active: false });
    expect(label.stripe.coupons.create).not.toHaveBeenCalled();
    expect(label.prisma.partnerCode.update.mock.calls[0][0].data).toMatchObject({
      stripeCouponMonthlyId: LOUIS29.stripeCouponMonthlyId, active: false,
    });
  });
});

describe('changement d’intervalle : conditions figées de l’abonné', () => {
  it('à vie : coupon annuel −200 € même si le code a changé depuis', async () => {
    const { service, stripe } = setup({ code: { priceMonthlyEur: 39 } });
    stripe.coupons.retrieve.mockResolvedValue({ id: 'x' });
    const r = { id: 'r1', createdAt: new Date('2026-10-01'), priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null };
    expect(await service.couponForIntervalChange(r as never, 'year', now)).toBe('mtc-partner-20000-forever');
  });

  it('3 mois, dont 2 écoulés : coupon de 1 mois restant ; durée écoulée : plus de remise', async () => {
    const { service } = setup();
    const r = { id: 'r1', createdAt: new Date('2026-08-01'), priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: 3 };
    expect(await service.couponForIntervalChange(r as never, 'year', now)).toBe('mtc-partner-20000-1');
    const old = { ...r, createdAt: new Date('2026-05-01') };
    expect(await service.couponForIntervalChange(old as never, 'year', now)).toBeNull();
  });
});
