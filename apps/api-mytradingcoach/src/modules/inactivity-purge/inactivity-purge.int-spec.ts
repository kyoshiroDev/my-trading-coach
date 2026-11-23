/** Purge des comptes inactifs (#824) sur vraie base : la sélection et ses exclusions sont dans le `where` Prisma. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { FounderSeatStatus, Role } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { inactiveWhere } from './inactivity-purge.service';
import { selectionCutoff } from './inactivity-purge.util';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
// Date réelle : seuls les comptes créés ici (adresse marquée RUN) sont lus.
const NOW = new Date();
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const SEAT = 900_000 + Math.floor(Math.random() * 90_000);

let app: INestApplication;
let prisma: PrismaService;
const ids: Record<string, string> = {};

/** Compte inactif depuis 800 jours, puis surcharge du cas testé. */
const make = async (key: string, over: Record<string, unknown> = {}) => {
  const u = await prisma.user.create({
    data: { email: `int-824-${key}-${RUN}@test.local`, password: 'x', createdAt: ago(1_000), lastSeenAt: ago(800), ...over },
  });
  ids[key] = u.id;
  return u.id;
};

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  // Éligibles.
  await make('inactif');
  await make('jamaisVu', { lastSeenAt: null, lastLoginAt: null });
  await make('resilie', { stripeSubscriptionStatus: 'canceled', stripeCurrentPeriodEnd: ago(500) });
  await make('interne', { isInternal: true });
  const ended = await make('fondateurPerdu');
  await prisma.founderSeat.create({ data: { number: SEAT, userId: ended, interval: 'month', status: FounderSeatStatus.LOST } });
  const paid = await make('commissionPayee', { role: Role.AMBASSADOR });
  await prisma.referralCommission.create({ data: { ambassadorId: paid, referredUserId: 'x', amount: 9.8, subscriptionId: `sub_${RUN}_p`, invoiceId: `in_${RUN}_p`, period: '2024-01', status: 'paid' } });
  // Exclus.
  await make('vuRecemment', { lastSeenAt: ago(10) });
  await make('connecteRecemment', { lastLoginAt: ago(5) });
  await make('inscritRecemment', { createdAt: ago(10), lastSeenAt: null });
  await make('demo', { isDemo: true });
  await make('admin', { role: Role.ADMIN });
  await make('abonne', { stripeSubscriptionStatus: 'active' });
  await make('enPause', { stripeSubscriptionStatus: 'paused' });
  await make('impaye', { stripeSubscriptionStatus: 'past_due' });
  await make('periodePayee', { stripeSubscriptionStatus: 'canceled', stripeCurrentPeriodEnd: later(20) });
  await make('premiumOffert', { trialEndsAt: later(5) });
  await make('essaiInscription', { signupTrialEndsAt: later(5) });
  const seat = await make('fondateur');
  await prisma.founderSeat.create({ data: { number: SEAT + 1, userId: seat, interval: 'month', status: FounderSeatStatus.ACTIVE } });
  const amb = await make('commissionDue', { role: Role.AMBASSADOR });
  await prisma.referralCommission.create({ data: { ambassadorId: amb, referredUserId: 'x', amount: 9.8, subscriptionId: `sub_${RUN}`, invoiceId: `in_${RUN}`, period: '2024-01' } });
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.founderSeat.deleteMany({ where: { number: { in: [SEAT, SEAT + 1] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@test.local` } } }).catch(() => undefined);
  }
  await app?.close().catch(() => undefined);
});

describe('Purge des comptes inactifs — sélection sur base réelle', () => {
  it('ne retient que les comptes sans connexion depuis le seuil et sans exclusion', async () => {
    const rows = await prisma.user.findMany({
      where: { AND: [inactiveWhere(NOW, selectionCutoff(NOW)), { email: { endsWith: `-${RUN}@test.local` } }] },
      select: { id: true },
    });
    const keyOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    expect(rows.map((r) => keyOf[r.id]).sort()).toEqual(['commissionPayee', 'fondateurPerdu', 'inactif', 'interne', 'jamaisVu', 'resilie']);
  });
});
