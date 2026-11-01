/**
 * États d'abonnement sur vraie base (#828) : chaque filtre de comptage (`subscriptionStateWhere`)
 * retrouve exactement les comptes que `subscriptionState` classe dans cet état ; `adminStats` compte
 * comme la fonction ; e-mails de fin d'essai J+11 / J+15 : reçus ou non, un compte par état, et un
 * abonné qui paie ne les reçoit JAMAIS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { subscriptionState, type SubscriptionKind } from '@mtc/shared';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../modules/users/users.service';
import { CAMPAIGNS_BY_KEY } from '../../modules/resend/campaigns/campaign-registry';
import { REAL_USERS_WHERE } from './real-users';
import { premiumAccessWhere, subscriptionStateWhere } from './subscription-state-where';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DAY = 86_400_000;
const NOW = new Date();
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

type Fixture = Partial<Prisma.UserCreateInput>;

/** Un compte par état du tableau de la phase 1, plus les cas limites. */
const STATES: Record<string, Fixture> = {
  's1-essai-inscription': { trialEndsAt: at(10), signupTrialEndsAt: at(10), trialSource: 'SIGNUP' },
  's2-reservation': { plan: 'PREMIUM', trialEndsAt: at(10), signupTrialEndsAt: at(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(10) },
  's3-paye-moins-48h': { plan: 'PREMIUM', trialEndsAt: at(1), signupTrialEndsAt: at(1), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(31) },
  's4-actif-apres-essai': { plan: 'PREMIUM', trialEndsAt: at(-3), signupTrialEndsAt: at(-3), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(27) },
  's5-essai-annule': { plan: 'PREMIUM', trialEndsAt: at(10), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(10), stripeCancelAt: at(10) },
  's6-en-pause': { trialEndsAt: at(-1), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due' },
  's7-apres-essai': { trialEndsAt: at(-2), signupTrialEndsAt: at(-2), trialSource: 'SIGNUP' },
  's8-ancien-essai-stripe': { plan: 'PREMIUM', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(20) },
  'offert-admin': { trialEndsAt: at(20), trialSource: 'ADMIN' },
  'offert-sans-origine': { trialEndsAt: at(5) },
  'beta': { role: 'BETA_TESTER' },
  'acces-manuel': { plan: 'PREMIUM' },
  'gratuit': {},
  'termine': { stripeSubscriptionStatus: 'canceled' },
  'impaye': { stripeSubscriptionStatus: 'unpaid' },
  'en-pause-essai-en-cours': { trialEndsAt: at(2), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due' },
};

/** E-mails de fin d'essai : essai d'inscription qui finit dans 2 jours (J+11) ou fini il y a 2 jours (J+15). */
const J11: Record<string, [Fixture, boolean]> = {
  'essai sans abonnement': [{ trialEndsAt: at(2) }, true],
  'réservation fondateur (trialing)': [{ plan: 'PREMIUM', trialEndsAt: at(2), stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: at(2) }, false],
  'payé tout de suite (active)': [{ plan: 'PREMIUM', trialEndsAt: at(2), stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(30) }, false],
  'essai d’abonnement annulé': [{ plan: 'PREMIUM', trialEndsAt: at(2), stripeSubscriptionStatus: 'trialing', stripeCancelAt: at(2) }, false],
  'en pause (past_due)': [{ trialEndsAt: at(2), stripeSubscriptionStatus: 'past_due' }, false],
  'prolongé par l’admin': [{ trialEndsAt: at(20), trialSource: 'ADMIN' }, false],
};
const J15: Record<string, [Fixture, boolean]> = {
  'après l’essai, sans abonnement': [{ trialEndsAt: at(-2) }, true],
  'abonné qui paie (active)': [{ plan: 'PREMIUM', trialEndsAt: at(-2), stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: at(28) }, false],
  'essai d’abonnement annulé puis terminé (canceled)': [{ trialEndsAt: at(-2), stripeSubscriptionStatus: 'canceled' }, true],
  'en pause (past_due)': [{ trialEndsAt: at(-2), stripeSubscriptionStatus: 'past_due' }, false],
  // Comportement d'avant #828, gardé à l'identique : `unpaid` n'est pas exclu (voir le rapport).
  'impayé définitif (unpaid)': [{ trialEndsAt: at(-2), stripeSubscriptionStatus: 'unpaid' }, true],
};

let app: INestApplication;
let prisma: PrismaService;
const ids = new Map<string, string>();

const create = async (label: string, f: Fixture) => {
  const u = await prisma.user.create({
    data: { email: `int-828-${label.replace(/[^a-z0-9]+/gi, '-')}-${RUN}@test.local`, password: 'x', ...f },
    select: { id: true },
  });
  ids.set(label, u.id);
};

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  for (const [label, f] of Object.entries(STATES)) await create(label, f);
  await create('exclu-admin', { role: 'ADMIN' });
  await create('exclu-demo', { isDemo: true, trialEndsAt: at(5), trialSource: 'SIGNUP' });
  for (const [label, [f]] of Object.entries(J11)) await create(`j11 ${label}`, { trialSource: 'SIGNUP', signupTrialEndsAt: at(2), ...f });
  for (const [label, [f]] of Object.entries(J15)) await create(`j15 ${label}`, { trialSource: 'SIGNUP', signupTrialEndsAt: at(-2), ...f });
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: 'int-828-', endsWith: `-${RUN}@test.local` } } }).catch(() => undefined);
  await app?.close().catch(() => undefined);
});

const STATE_SELECT = {
  id: true, plan: true, role: true, trialEndsAt: true, trialSource: true,
  stripeSubscriptionStatus: true, stripeCurrentPeriodEnd: true, stripeCancelAt: true,
} as const;
const KINDS: SubscriptionKind[] = ['paying', 'subscription_trial', 'paused', 'signup_trial', 'offered', 'role', 'manual', 'free'];

describe('subscriptionStateWhere ≡ subscriptionState (#828)', () => {
  it.each(KINDS)('%s : le filtre retrouve exactement les comptes de cet état', async (kind) => {
    const mine = [...ids.values()];
    const rows = await prisma.user.findMany({ where: { id: { in: mine } }, select: STATE_SELECT });
    const expected = rows.filter((u) => subscriptionState(u, NOW).kind === kind).map((u) => u.id).sort();
    const found = (await prisma.user.findMany({ where: { AND: [{ id: { in: mine } }, subscriptionStateWhere(kind, NOW)] }, select: { id: true } }))
      .map((u) => u.id).sort();
    expect(found).toEqual(expected);
  });

  it('chaque compte est dans un état et un seul', async () => {
    const mine = [...ids.values()];
    let total = 0;
    for (const kind of KINDS) {
      total += await prisma.user.count({ where: { AND: [{ id: { in: mine } }, subscriptionStateWhere(kind, NOW)] } });
    }
    expect(total).toBe(mine.length);
  });

  it('accès Premium : même règle que la fonction', async () => {
    const mine = [...ids.values()];
    const rows = await prisma.user.findMany({ where: { id: { in: mine } }, select: STATE_SELECT });
    const expected = rows.filter((u) => subscriptionState(u, NOW).premiumAccess).map((u) => u.id).sort();
    const found = (await prisma.user.findMany({ where: { AND: [{ id: { in: mine } }, premiumAccessWhere(NOW)] }, select: { id: true } }))
      .map((u) => u.id).sort();
    expect(found).toEqual(expected);
  });

  it('les états attendus du tableau', async () => {
    const kindOf = async (label: string) =>
      subscriptionState(await prisma.user.findUniqueOrThrow({ where: { id: ids.get(label)! }, select: STATE_SELECT }), NOW).kind;
    expect(await kindOf('s1-essai-inscription')).toBe('signup_trial');
    expect(await kindOf('s2-reservation')).toBe('subscription_trial');
    expect(await kindOf('s3-paye-moins-48h')).toBe('paying');
    expect(await kindOf('s5-essai-annule')).toBe('subscription_trial');
    expect(await kindOf('s6-en-pause')).toBe('paused');
    expect(await kindOf('s7-apres-essai')).toBe('free');
    expect(await kindOf('offert-sans-origine')).toBe('offered');
  });
});

describe('adminStats compte comme subscriptionState (#828)', () => {
  it('essais, offerts, en pause, gratuits et accès Premium : hors démo et hors ADMIN', async () => {
    // Toute la base (d'autres lignes peuvent exister) : la référence est la fonction sur les comptes réels.
    const real = await prisma.user.findMany({ where: REAL_USERS_WHERE, select: STATE_SELECT });
    const states = real.map((u) => subscriptionState(u, new Date()));
    const count = (pred: (s: (typeof states)[number]) => boolean) => states.filter(pred).length;
    const stats = await app.get(UsersService).adminStats();

    expect(stats.trials).toBe(count((s) => s.kind === 'signup_trial' || s.kind === 'subscription_trial'));
    expect(stats.offered).toBe(count((s) => s.kind === 'offered'));
    expect(stats.paused).toBe(count((s) => s.kind === 'paused'));
    expect(stats.freeUsers).toBe(count((s) => s.kind === 'free'));
    expect(stats.totalPremium).toBe(count((s) => s.premiumAccess));
    // Les comptes du test pèsent bien dans les cases attendues.
    expect(stats.trials).toBeGreaterThanOrEqual(4); // s1, s2, s5, s8
    expect(stats.paused).toBeGreaterThanOrEqual(3); // s6, impayé, en pause avec essai
  });
});

describe('e-mails de fin d’essai : reçu ou non, par état (#828)', () => {
  const recipients = async (key: 'trial_ending' | 'trial_ended') => {
    const segment = CAMPAIGNS_BY_KEY.get(key)!.segment(new Date());
    const rows = await prisma.user.findMany({ where: { AND: [segment, { id: { in: [...ids.values()] } }] }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  };

  it.each(Object.entries(J11))('J+11 (trial_ending) · %s', async (label, [, receives]) => {
    expect((await recipients('trial_ending')).has(ids.get(`j11 ${label}`)!)).toBe(receives);
  });

  it.each(Object.entries(J15))('J+15 (trial_ended) · %s', async (label, [, receives]) => {
    expect((await recipients('trial_ended')).has(ids.get(`j15 ${label}`)!)).toBe(receives);
  });

  it('un abonné qui paie (active) ne reçoit JAMAIS ni J+11 ni J+15', async () => {
    const paying = await prisma.user.findMany({
      where: { id: { in: [...ids.values()] }, stripeSubscriptionStatus: 'active' },
      select: { id: true },
    });
    expect(paying.length).toBeGreaterThanOrEqual(4);
    const ending = await recipients('trial_ending');
    const ended = await recipients('trial_ended');
    for (const { id } of paying) {
      expect(ending.has(id)).toBe(false);
      expect(ended.has(id)).toBe(false);
    }
  });
});
