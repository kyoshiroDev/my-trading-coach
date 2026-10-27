/**
 * Suivi de l'essai d'inscription dans l'entonnoir admin (#769, B3), sur une vraie base : la requête
 * SQL compte les essais en cours, terminés, convertis et les réservations fondateur jamais payées,
 * hors démo et admin. Mesure par différence : d'autres specs partagent la base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminService } from './admin.service';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const PREFIX = `int-b3-${RUN}-`;
const DAY = 86_400_000;
let app: INestApplication;
let prisma: PrismaService;
let admin: AdminService;
const seatNumbers: number[] = [];

const at = (days: number) => new Date(Date.now() + days * DAY);
const user = (tag: string, data: Partial<Prisma.UserCreateInput>) =>
  prisma.user.create({ data: { email: `${PREFIX}${tag}@test.local`, password: 'x', name: tag, ...data } });
async function seat(userId: string, firstPaidAt: Date | null) {
  const last = await prisma.founderSeat.aggregate({ _max: { number: true } });
  const number = Math.max(last._max.number ?? 0, 9_000) + 1;
  seatNumbers.push(number);
  await prisma.founderSeat.create({ data: { number, userId, interval: 'month', stripeSubscriptionId: `sub_${PREFIX}${number}`, firstPaidAt } });
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  admin = app.get(AdminService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.founderSeat.deleteMany({ where: { number: { in: seatNumbers } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('Entonnoir admin : essai de l’inscription (#769, B3)', () => {
  it('en cours, terminés, convertis, réservations en attente ; démo et admin exclus', async () => {
    const before = (await admin.getFunnel(30)).signupTrial;

    await user('en-cours', { signupTrialEndsAt: at(5), trialEndsAt: at(5), trialSource: 'SIGNUP' });
    await user('paye-pendant', { signupTrialEndsAt: at(5), trialEndsAt: at(5), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active' });
    await user('converti', { signupTrialEndsAt: at(-2), trialEndsAt: at(-2), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', plan: 'PREMIUM' });
    await user('non-converti', { signupTrialEndsAt: at(-3), trialEndsAt: at(-3), trialSource: 'SIGNUP' });
    await user('ancien', { signupTrialEndsAt: at(-40), trialEndsAt: at(-40), trialSource: 'SIGNUP' });
    await user('demo', { signupTrialEndsAt: at(5), trialEndsAt: at(5), isDemo: true });
    await user('admin', { signupTrialEndsAt: at(-2), trialEndsAt: at(-2), role: 'ADMIN', stripeSubscriptionStatus: 'active' });
    const charge = at(9);
    const resa = await user('reserve', {
      signupTrialEndsAt: charge, trialEndsAt: charge, trialSource: 'SIGNUP', plan: 'PREMIUM',
      stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: charge,
    });
    await seat(resa.id, null);
    const pending = await user('3ds', { signupTrialEndsAt: at(-1), trialEndsAt: at(-1), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due' });
    await seat(pending.id, null);
    const paid = await user('fondateur-paye', { signupTrialEndsAt: at(-4), trialEndsAt: at(-4), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', plan: 'PREMIUM' });
    await seat(paid.id, at(-4));
    const demoResa = await user('demo-reserve', { signupTrialEndsAt: at(9), isDemo: true, stripeSubscriptionStatus: 'trialing' });
    await seat(demoResa.id, null);

    const after = (await admin.getFunnel(30)).signupTrial;
    expect({
      inProgress: after.inProgress - before.inProgress,
      ended: after.ended - before.ended,
      converted: after.converted - before.converted,
      reservations: after.reservations - before.reservations,
      reservationsAwaitingPayment: after.reservationsAwaitingPayment - before.reservationsAwaitingPayment,
    }).toEqual({
      inProgress: 2, // en-cours + reserve (paye-pendant a un abonnement payant ; démo exclue)
      ended: 4, // converti, non-converti, 3ds, fondateur-paye (ancien hors période ; admin exclu)
      converted: 2, // converti, fondateur-paye
      reservations: 2, // reserve, 3ds (fondateur-paye a payé ; démo exclue)
      reservationsAwaitingPayment: 1, // 3ds
    });
    expect(after.nextChargeAt).not.toBeNull();
    expect(Date.parse(after.nextChargeAt!)).toBeLessThanOrEqual(charge.getTime());
  });
});
