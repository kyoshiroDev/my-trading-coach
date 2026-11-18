/**
 * « Retirer le Premium offert » (B10 #1064), sur une vraie base : l'écriture conditionnelle
 * (`subscriptionStateWhere('offered')`) retire bien les offerts, origine ADMIN ou absente, avec ou
 * sans ancien abonnement terminé, et n'écrase jamais un abonnement Stripe arrivé entre la lecture
 * et l'écriture (webhook). Le double Prisma des tests unitaires ne prouve pas ce que fait le SQL
 * (`notIn` écarte les NULL, `trialSource: null` = IS NULL).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, type INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

const PREFIX = 'int-1064-';
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

let app: INestApplication;
let prisma: PrismaService;
let users: UsersService;

const email = (tag: string) => `${PREFIX}${tag}-${RUN}@test.local`;
const create = (tag: string, data: Partial<Prisma.UserCreateInput>) =>
  prisma.user.create({ data: { email: email(tag), password: 'x', ...data }, select: { id: true } });
const state = (id: string) =>
  prisma.user.findUniqueOrThrow({
    where: { id },
    select: { trialEndsAt: true, trialSource: true, stripeSubscriptionStatus: true },
  });

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  users = app.get(UsersService);
}, 120_000);

afterAll(async () => {
  await prisma?.user.deleteMany({ where: { email: { startsWith: PREFIX, endsWith: `-${RUN}@test.local` } } });
  await app?.close().catch(() => undefined);
});

describe('removeOfferedPremium sur une vraie base (B10 #1064)', () => {
  it.each([
    ['origine ADMIN, jamais abonné', { trialSource: 'ADMIN' as const }],
    ['origine absente (offert d’avant #769)', { trialSource: null }],
    ['ancien abonnement terminé (canceled)', { trialSource: 'ADMIN' as const, stripeSubscriptionStatus: 'canceled' }],
  ])('%s : retiré, accès coupé', async (tag, data) => {
    const { id } = await create(tag.replace(/\W+/g, '-'), { trialEndsAt: at(20), ...data });
    await expect(users.removeOfferedPremium(id)).resolves.toEqual({ trialEndsAt: null });
    expect((await state(id)).trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('abonnement Stripe arrivé entre la lecture et l’écriture : 409, ligne intacte', async () => {
    const { id } = await create('course', {
      trialEndsAt: at(20), trialSource: 'ADMIN', stripeSubscriptionStatus: 'active',
    });
    const before = await state(id);
    // La lecture voit l'état d'avant le webhook (offert, sans abonnement) ; l'écriture voit l'abonné.
    const spy = vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
      isDemo: false, trialSource: 'ADMIN', trialEndsAt: before.trialEndsAt,
      signupTrialEndsAt: null, stripeSubscriptionStatus: null,
    } as never);
    await expect(users.removeOfferedPremium(id)).rejects.toBeInstanceOf(ConflictException);
    spy.mockRestore();
    expect(await state(id)).toEqual(before);
  });

  it('essai d’inscription (SIGNUP) : jamais écrit', async () => {
    const { id } = await create('signup', { trialEndsAt: at(10), trialSource: 'SIGNUP' });
    const before = await state(id);
    const spy = vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
      isDemo: false, trialSource: 'ADMIN', trialEndsAt: before.trialEndsAt,
      signupTrialEndsAt: null, stripeSubscriptionStatus: null,
    } as never);
    await expect(users.removeOfferedPremium(id)).rejects.toBeInstanceOf(ConflictException);
    spy.mockRestore();
    expect(await state(id)).toEqual(before);
  });

  it('offert pendant l’essai d’inscription encore en cours : l’essai est rendu', async () => {
    const signupEnd = at(5);
    const { id } = await create('rendu', { trialEndsAt: at(35), trialSource: 'ADMIN', signupTrialEndsAt: signupEnd });
    await expect(users.removeOfferedPremium(id)).resolves.toEqual({ trialEndsAt: signupEnd.toISOString() });
    expect(await state(id)).toEqual({ trialEndsAt: signupEnd, trialSource: 'SIGNUP', stripeSubscriptionStatus: null });
  });
});
