/**
 * Offre fondateur : anti-survente et numéros, sur une VRAIE base Postgres (verrou
 * `pg_advisory_xact_lock`). Un double Prisma ne prouverait rien : la course n'existe que
 * lorsque deux transactions s'exécutent réellement en parallèle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, INestApplication } from '@nestjs/common';
import { FounderSeatStatus } from '@prisma/client';
import { FOUNDER_OFFER } from '@mtc/shared';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { FounderOfferService } from './founder-offer.service';

const PREFIX = 'int-founder-';
let app: INestApplication;
let prisma: PrismaService;
let founders: FounderOfferService;

const newUser = (tag: string) =>
  prisma.user.create({ data: { email: `${PREFIX}${tag}-${Date.now()}@test.local`, password: 'x', name: tag } });

/** Base propre : aucune place ni réservation fondateur, offre ouverte. */
async function reset() {
  await prisma.checkoutReservation.deleteMany({});
  await prisma.founderSeat.deleteMany({});
  await prisma.founderOfferConfig.upsert({
    where: { id: 1 },
    create: { id: 1, open: true },
    update: { open: true, endsAt: null, notifiedMilestones: [] },
  });
  await founders.invalidateSeatsLeft();
}

/** `n` places déjà prises (comptes supprimés depuis : userId null, la place reste comptée). */
async function takeSeats(n: number) {
  await prisma.founderSeat.createMany({
    data: Array.from({ length: n }, (_, i) => ({ number: i + 1, interval: 'month', status: FounderSeatStatus.ACTIVE })),
  });
  await founders.invalidateSeatsLeft();
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  founders = app.get(FounderOfferService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.checkoutReservation.deleteMany({});
    await prisma.founderSeat.deleteMany({});
    await prisma.founderOfferConfig.update({ where: { id: 1 }, data: { open: false, notifiedMilestones: [] } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('anti-survente : la dernière place', () => {
  it('deux checkouts simultanés pour la dernière place → un seul réserve, l’autre est refusé', async () => {
    await reset();
    await takeSeats(FOUNDER_OFFER.seats - 1);
    const [a, b] = await Promise.all([newUser('a'), newUser('b')]);

    const results = await Promise.allSettled([
      founders.reserve(a.id, 'month', 'carte'),
      founders.reserve(b.id, 'year', 'bandeau'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await founders.seatsLeft()).toBe(0);
  });

  it('le paiement de la réservation donne le n° 200 ; un paiement sans place est refusé (null)', async () => {
    await reset();
    await takeSeats(FOUNDER_OFFER.seats - 1);
    const [a, b] = await Promise.all([newUser('pay'), newUser('late')]);
    await founders.reserve(a.id, 'month', 'carte');

    const seat = await founders.claimSeat({ userId: a.id, interval: 'month', stripeSubscriptionId: 'sub_a' });
    expect(seat?.number).toBe(FOUNDER_OFFER.seats);
    expect(seat?.cta).toBe('carte');
    expect(await prisma.checkoutReservation.count({ where: { userId: a.id } })).toBe(0);

    // Pas de réservation, plus de place : jamais de 201e fondateur.
    expect(await founders.claimSeat({ userId: b.id, interval: 'month', stripeSubscriptionId: 'sub_b' })).toBeNull();
    expect(await prisma.founderSeat.count({ where: { status: { in: ['ACTIVE', 'LOST'] } } })).toBe(FOUNDER_OFFER.seats);
  });

  it('webhook rejoué : la même place, aucun second numéro', async () => {
    await reset();
    const a = await newUser('replay');
    await founders.reserve(a.id, 'month', null);
    const first = await founders.claimSeat({ userId: a.id, interval: 'month', stripeSubscriptionId: 'sub_r' });
    const again = await founders.claimSeat({ userId: a.id, interval: 'month', stripeSubscriptionId: 'sub_r' });
    expect(again?.number).toBe(first?.number);
    expect(await prisma.founderSeat.count()).toBe(1);
  });
});

describe('numéros jamais réattribués, places rendues ou gardées', () => {
  it('premier paiement remboursé → place rendue, mais le numéro suivant est 201, pas 200', async () => {
    await reset();
    await takeSeats(FOUNDER_OFFER.seats - 1);
    const [a, b] = await Promise.all([newUser('refund'), newUser('next')]);
    await founders.reserve(a.id, 'month', null);
    await founders.claimSeat({ userId: a.id, interval: 'month', stripeSubscriptionId: 'sub_refund' });

    const refunded = await founders.refundFirstPayment(a.id);
    expect(refunded?.status).toBe('REFUNDED');
    expect(await founders.seatsLeft()).toBe(1);

    await founders.reserve(b.id, 'year', null);
    const next = await founders.claimSeat({ userId: b.id, interval: 'year', stripeSubscriptionId: 'sub_next' });
    expect(next?.number).toBe(FOUNDER_OFFER.seats + 1);
  });

  it('abonnement terminé → tarif perdu (LOST) mais la place reste prise', async () => {
    await reset();
    const a = await newUser('lost');
    await founders.reserve(a.id, 'month', null);
    await founders.claimSeat({ userId: a.id, interval: 'month', stripeSubscriptionId: 'sub_lost' });
    const before = await founders.seatsLeft();

    expect((await founders.markLost('sub_lost'))?.status).toBe('LOST');
    await founders.invalidateSeatsLeft();
    expect(await founders.seatsLeft()).toBe(before);
    expect((await founders.eligibility({ ...a, role: a.role, stripeSubscriptionStatus: null, stripePriceId: null }, [])).reason).toBe('tariff_lost');
  });

  it('session Checkout expirée → la réservation rend sa place', async () => {
    await reset();
    const a = await newUser('expire');
    const r = await founders.reserve(a.id, 'month', null);
    await founders.attachSession(r.id, `cs_test_${Date.now()}`);
    expect(await founders.seatsLeft()).toBe(FOUNDER_OFFER.seats - 1);
    await founders.releaseReservation({ stripeSessionId: (await prisma.checkoutReservation.findUniqueOrThrow({ where: { id: r.id } })).stripeSessionId! });
    expect(await founders.seatsLeft()).toBe(FOUNDER_OFFER.seats);
  });
});
