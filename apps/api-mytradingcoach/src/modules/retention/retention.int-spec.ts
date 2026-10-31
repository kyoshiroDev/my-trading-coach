/** Rétention (SCA-B5-09) sur vraie base : le DELETE brut par lots, sur chacune des 4 tables. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { DAILY_RETENTION_RULES, RetentionCron } from './retention.cron';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
// Date réelle : la purge ne touche que des lignes vraiment anciennes, jamais celles que d'autres
// tests d'intégration créent au même moment sur la même base.
const NOW = new Date();
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let app: INestApplication;
let prisma: PrismaService;
let userId: string;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  userId = (await prisma.user.create({ data: { email: `int-b5-retention-${RUN}@test.local`, password: 'x' } })).id;
  await prisma.marketNews.createMany({
    data: [
      { url: `https://x/${RUN}/vieille`, symbol: 'NQ', title: 'vieille', publishedDate: ago(31) },
      { url: `https://x/${RUN}/recente`, symbol: 'NQ', title: 'récente', publishedDate: ago(29) },
    ],
  });
  await prisma.stripeEvent.createMany({
    data: [
      { id: `evt_${RUN}_vieux`, type: 'test', processedAt: ago(91) },
      { id: `evt_${RUN}_recent`, type: 'test', processedAt: ago(89) },
    ],
  });
  await prisma.aiUsageLog.createMany({
    data: [
      { userId, feature: `int-${RUN}`, model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: ago(400) },
      { userId, feature: `int-${RUN}`, model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: ago(390) },
    ],
  });
  await prisma.userDailyActivity.createMany({
    data: [
      { userId, date: ago(731) },
      { userId, date: ago(729) },
    ],
  });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.marketNews.deleteMany({ where: { url: { startsWith: `https://x/${RUN}/` } } }).catch(() => undefined);
    await prisma.stripeEvent.deleteMany({ where: { id: { startsWith: `evt_${RUN}_` } } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await app?.close().catch(() => undefined);
});

describe('Rétention — base réelle', () => {
  it('supprime au-delà du délai de chaque table, garde le reste', async () => {
    await app.get(RetentionCron).purgeAll(NOW);

    expect((await prisma.marketNews.findMany({ where: { url: { startsWith: `https://x/${RUN}/` } }, select: { title: true } })).map((n) => n.title)).toEqual(['récente']);
    expect((await prisma.stripeEvent.findMany({ where: { id: { startsWith: `evt_${RUN}_` } }, select: { id: true } })).map((e) => e.id)).toEqual([`evt_${RUN}_recent`]);
    expect(await prisma.aiUsageLog.count({ where: { feature: `int-${RUN}` } })).toBe(1);
    expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(1);
  });
});

describe('Rétention quotidienne des événements d’usage — base réelle', () => {
  it('supprime les lignes de plus de 13 mois, garde les autres, ne touche à aucune autre table', async () => {
    await prisma.productEventDaily.createMany({
      data: [
        { userId, date: ago(397), event: 'install_shown', place: 'ios' },
        { userId, date: ago(395), event: 'install_shown', place: 'ios-other' },
        { userId, date: ago(1), event: 'premium_seen', place: 'dashboard' },
      ],
    });
    // Témoins d'autres tables, assez vieux pour la purge mensuelle : la quotidienne les laisse.
    await prisma.aiUsageLog.create({
      data: { userId, feature: `int-daily-${RUN}`, model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0, createdAt: ago(1000) },
    });
    await prisma.userDailyActivity.create({ data: { userId, date: ago(1000) } });

    const deleted = await app.get(RetentionCron).purgeAll(NOW, DAILY_RETENTION_RULES);

    expect(Object.keys(deleted)).toEqual(['ProductEventDaily']);
    const left = await prisma.productEventDaily.findMany({ where: { userId }, select: { place: true }, orderBy: { date: 'asc' } });
    expect(left.map((r) => r.place)).toEqual(['ios-other', 'dashboard']);
    expect(await prisma.aiUsageLog.count({ where: { feature: `int-daily-${RUN}` } })).toBe(1);
    expect(await prisma.userDailyActivity.count({ where: { userId, date: { lt: ago(999) } } })).toBe(1);
  });

  it('la suppression du compte efface ses événements d’usage (cascade)', async () => {
    const u = await prisma.user.create({ data: { email: `int-pe-cascade-${RUN}@test.local`, password: 'x' } });
    await prisma.productEventDaily.create({ data: { userId: u.id, date: ago(0), event: 'install_done', place: 'android' } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.productEventDaily.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('Identifiants Stripe des places et remises sans compte, 180 jours — base réelle (#826)', () => {
  // Numéros de place hors de la plage réelle (1 à 200), propres à ce passage.
  const BASE = 900_000 + Math.floor(Math.random() * 90_000);
  const sub = (k: string) => `sub_${RUN}_${k}`;
  let livingId: string;
  let codeId: string;

  beforeAll(async () => {
    livingId = (await prisma.user.create({ data: { email: `int-826-vivant-${RUN}@test.local`, password: 'x' } })).id;
    codeId = (await prisma.partnerCode.create({
      data: {
        code: `INT826${RUN}`.toUpperCase().slice(0, 20), label: 'int 826', priceMonthlyEur: 29, priceAnnualEur: 290,
        stripeCouponMonthlyId: 'coupon_m', stripeCouponAnnualId: 'coupon_a',
      },
    })).id;
    await prisma.founderSeat.createMany({
      data: [
        // Sans compte, perdue il y a 181 j : effacée.
        { number: BASE + 1, userId: null, status: 'LOST', interval: 'month', stripeSubscriptionId: sub('lost181'), endedAt: ago(181) },
        // Sans compte, perdue il y a 179 j : gardée (moins de 180 j).
        { number: BASE + 2, userId: null, status: 'LOST', interval: 'month', stripeSubscriptionId: sub('lost179'), endedAt: ago(179) },
        // ACTIVE sans compte (webhook de fin jamais traité) : jamais touchée.
        { number: BASE + 3, userId: null, status: 'ACTIVE', interval: 'month', stripeSubscriptionId: sub('active'), endedAt: ago(400) },
        // Terminée sans date de fin : jamais touchée, signalée.
        { number: BASE + 4, userId: null, status: 'LOST', interval: 'month', stripeSubscriptionId: sub('noend'), endedAt: null },
        // Compte encore lié (abonnement terminé, compte vivant) : jamais touchée.
        { number: BASE + 5, userId: livingId, status: 'LOST', interval: 'month', stripeSubscriptionId: sub('linked'), endedAt: ago(400) },
        // RELEASED d'un compte vivant (`releaseUnpaid` détache la place) : même règle, effacée à 180 j.
        { number: BASE + 6, userId: null, status: 'RELEASED', interval: 'month', stripeSubscriptionId: sub('released'), endedAt: ago(200) },
      ],
    });
    await prisma.partnerRedemption.createMany({
      data: [
        { partnerCodeId: codeId, userId: null, priceMonthlyEur: 29, priceAnnualEur: 290, stripeCouponId: 'c', status: 'LOST', stripeSubscriptionId: sub('r-lost181'), endedAt: ago(181) },
        { partnerCodeId: codeId, userId: null, priceMonthlyEur: 29, priceAnnualEur: 290, stripeCouponId: 'c', status: 'RELEASED', stripeSubscriptionId: sub('r-rel179'), endedAt: ago(179) },
        { partnerCodeId: codeId, userId: null, priceMonthlyEur: 29, priceAnnualEur: 290, stripeCouponId: 'c', status: 'ACTIVE', stripeSubscriptionId: sub('r-active'), endedAt: null },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.founderSeat.deleteMany({ where: { number: { gte: BASE, lt: BASE + 100 } } }).catch(() => undefined);
    if (codeId) {
      await prisma.partnerRedemption.deleteMany({ where: { partnerCodeId: codeId } }).catch(() => undefined);
      await prisma.partnerCode.delete({ where: { id: codeId } }).catch(() => undefined);
    }
    if (livingId) await prisma.user.delete({ where: { id: livingId } }).catch(() => undefined);
  });

  const seats = async () =>
    Object.fromEntries(
      (await prisma.founderSeat.findMany({ where: { number: { gte: BASE, lt: BASE + 100 } }, select: { number: true, stripeSubscriptionId: true, status: true } }))
        .map((s) => [s.number - BASE, s]),
    );
  const redemptions = async () =>
    Object.fromEntries(
      (await prisma.partnerRedemption.findMany({ where: { partnerCodeId: codeId }, select: { stripeSubscriptionId: true, status: true, endedAt: true } }))
        .map((r) => [r.status + (r.endedAt ? Math.round((NOW.getTime() - r.endedAt.getTime()) / DAY) : 'nul'), r.stripeSubscriptionId]),
    );

  it('efface au-delà de 180 jours, garde en deçà, ne touche jamais une ligne ACTIVE, sans fin ou liée à un compte', async () => {
    const report = await app.get(RetentionCron).detachStripeIds(NOW);

    const s = await seats();
    expect(s[1].stripeSubscriptionId).toBeNull(); // 181 j
    expect(s[2].stripeSubscriptionId).toBe(sub('lost179')); // 179 j
    expect(s[3]).toMatchObject({ status: 'ACTIVE', stripeSubscriptionId: sub('active') });
    expect(s[4].stripeSubscriptionId).toBe(sub('noend'));
    expect(s[5].stripeSubscriptionId).toBe(sub('linked'));
    expect(s[6]).toMatchObject({ status: 'RELEASED', stripeSubscriptionId: null });
    // Le compte vivant garde son propre lien (rien n'est écrit sur User).
    expect(await prisma.user.findUnique({ where: { id: livingId }, select: { id: true } })).not.toBeNull();

    expect(await redemptions()).toEqual({ LOST181: null, RELEASED179: sub('r-rel179'), ACTIVEnul: sub('r-active') });

    // Comptés (la base locale peut contenir d'autres lignes : au moins les nôtres).
    expect(report.founderSeats.activeWithoutAccount).toBeGreaterThanOrEqual(1);
    expect(report.founderSeats.missingEndedAt).toBeGreaterThanOrEqual(1);
    expect(report.partnerRedemptions.activeWithoutAccount).toBeGreaterThanOrEqual(1);
  });

  it('rejeu : sans effet sur des lignes déjà traitées', async () => {
    const before = { s: await seats(), r: await redemptions() };
    await app.get(RetentionCron).detachStripeIds(NOW);
    expect(await seats()).toEqual(before.s);
    expect(await redemptions()).toEqual(before.r);
  });
});
