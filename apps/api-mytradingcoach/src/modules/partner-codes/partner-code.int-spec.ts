/**
 * Codes partenaires : dernière utilisation disputée, sur une VRAIE base Postgres (verrou
 * `pg_advisory_xact_lock`). Le code est créé directement en base : aucun appel Stripe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnerCodeService } from './partner-code.service';

const PREFIX = 'int-partner-';
const CODE = 'INTLAST';
let app: INestApplication;
let prisma: PrismaService;
let partners: PartnerCodeService;

const newUser = (tag: string) =>
  prisma.user.create({ data: { email: `${PREFIX}${tag}-${Date.now()}@test.local`, password: 'x', name: tag } });

async function cleanup() {
  const code = await prisma.partnerCode.findUnique({ where: { code: CODE } });
  if (code) {
    await prisma.checkoutReservation.deleteMany({ where: { partnerCodeId: code.id } });
    await prisma.partnerRedemption.deleteMany({ where: { partnerCodeId: code.id } });
    await prisma.partnerCode.delete({ where: { id: code.id } });
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

/** Code à `max` utilisations, dont `used` déjà consommées (abonnés existants). */
async function seedCode(max: number, used: number) {
  await cleanup();
  const code = await prisma.partnerCode.create({
    data: {
      code: CODE, label: 'Intégration', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null,
      maxRedemptions: max, stripeCouponMonthlyId: 'mtc-partner-2000-forever', stripeCouponAnnualId: 'mtc-partner-20000-forever',
    },
  });
  for (let i = 0; i < used; i++) {
    const u = await newUser(`old${i}`);
    await prisma.partnerRedemption.create({
      data: {
        partnerCodeId: code.id, userId: u.id, priceMonthlyEur: 29, priceAnnualEur: 290,
        stripeCouponId: code.stripeCouponMonthlyId, stripeSubscriptionId: `sub_old_${i}`,
      },
    });
  }
  return code;
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  partners = app.get(PartnerCodeService);
}, 120_000);

afterAll(async () => {
  if (prisma) await cleanup();
  await app?.close().catch(() => undefined);
});

describe('dernière utilisation d’un code', () => {
  it('deux checkouts simultanés → un seul réserve, l’autre est refusé (quota atteint)', async () => {
    await seedCode(3, 2);
    const [a, b] = await Promise.all([newUser('a'), newUser('b')]);

    const results = await Promise.allSettled([
      partners.reserve(a.id, CODE.toLowerCase(), 'month', null),
      partners.reserve(b.id, CODE, 'year', null),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await partners.validate(CODE)).toMatchObject({ valid: false, reason: 'exhausted' });
  });

  it('paiement → utilisation comptée, conditions figées ; rejoué → aucune seconde utilisation', async () => {
    const code = await seedCode(3, 2);
    const a = await newUser('pay');
    await partners.reserve(a.id, CODE, 'year', 'promo');

    const r = await partners.claim({ userId: a.id, code: CODE, stripeSubscriptionId: 'sub_a', interval: 'year' });
    expect(r).toMatchObject({ priceMonthlyEur: 29, priceAnnualEur: 290, stripeCouponId: code.stripeCouponAnnualId, cta: 'promo' });
    await partners.claim({ userId: a.id, code: CODE, stripeSubscriptionId: 'sub_a', interval: 'year' });
    expect(await prisma.partnerRedemption.count({ where: { partnerCodeId: code.id } })).toBe(3);
    expect(await prisma.checkoutReservation.count({ where: { userId: a.id } })).toBe(0);

    // Une seule utilisation par personne.
    expect(await partners.validate(CODE, a.id)).toMatchObject({ valid: false });
  });

  it('remboursement → utilisation rendue (quota libéré) ; résiliation → reste comptée', async () => {
    await seedCode(3, 2);
    const a = await newUser('refund');
    await partners.reserve(a.id, CODE, 'month', null);
    await partners.claim({ userId: a.id, code: CODE, stripeSubscriptionId: 'sub_refund', interval: 'month' });
    expect(await partners.validate(CODE)).toMatchObject({ reason: 'exhausted' });

    await partners.release('sub_refund');
    expect((await partners.validate(CODE)).valid).toBe(true);

    await partners.markLost('sub_old_0');
    expect((await partners.validate(CODE)).valid).toBe(true);
    expect(await partners.usedCount((await prisma.partnerCode.findUniqueOrThrow({ where: { code: CODE } })).id)).toBe(2);
  });
});
