import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { GiveawayActivation, GiveawayPool } from '@prisma/client';
import { GiveawayPrizeService, safePrizeError } from './giveaway-prize.service';
import { freezeClock } from '../../test/freeze-clock';

const NOW = new Date('2027-02-01T08:00:00Z');
freezeClock(NOW);

let win: Record<string, unknown>;
const prisma = {
  giveawayWin: {
    findUnique: vi.fn(async () => win),
    updateMany: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({ count: 1 })),
  },
};
const users = { grantGiveawayPremium: vi.fn() };
const stripe = { billingFacts: vi.fn(), creditGiveaway: vi.fn(async (_args: { customerId: string; winId: string; cents: number; months: number }) => 'cbtxn_1') };
const resend = { send: vi.fn(async (_mail: { to: string; subject: string; html: string; from?: string; replyTo?: string }) => undefined) };
const config = { get: vi.fn(() => 'https://app.test') };
const service = new GiveawayPrizeService(prisma as never, users as never, stripe as never, resend as never, config as never);

const user = { email: 'g@test.local', name: 'Gagnant Test', stripeCustomerId: 'cus_1' };

beforeEach(() => {
  vi.clearAllMocks();
  win = { id: 'w1', pool: GiveawayPool.FREE, prizeMonths: 1, activationStatus: GiveawayActivation.PENDING, userId: 'u1', user };
});

describe('GiveawayPrizeService', () => {
  it('lot gratuit : Premium offert (origine GIVEAWAY), dates de l’attribution, e-mail au gagnant depuis contact@', async () => {
    const startsAt = new Date('2027-02-05T08:00:00Z'); // essai d'inscription en cours : le lot part de sa fin
    const endsAt = new Date('2027-03-05T08:00:00Z');
    users.grantGiveawayPremium.mockResolvedValue({ startsAt, endsAt });
    expect(await service.apply('w1', NOW)).toEqual({ status: GiveawayActivation.APPLIED, error: null });
    expect(users.grantGiveawayPremium).toHaveBeenCalledWith('u1', 1, NOW);
    expect(prisma.giveawayWin.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'w1', activationStatus: { not: GiveawayActivation.APPLIED } },
      data: { activationStatus: GiveawayActivation.APPLIED, startsAt, endsAt, creditCents: null },
    });
    const mail = resend.send.mock.calls[0][0];
    expect(mail.to).toBe('g@test.local');
    expect(mail.from).toContain('contact@mytradingcoach.app');
    expect(mail.html).toContain('/concours/gagnant');
    expect(mail.html).toContain('5 mars 2027');
  });

  it('lot Premium mensuel : avoir de 3 mensualités réellement facturées', async () => {
    win = { ...win, pool: GiveawayPool.PREMIUM, prizeMonths: 3 };
    stripe.billingFacts.mockResolvedValue({ paidInvoices: 4, firstPaidAt: new Date(), chargeCents: 2900, interval: 'month' });
    await service.apply('w1', NOW);
    expect(stripe.creditGiveaway).toHaveBeenCalledWith({ customerId: 'cus_1', winId: 'w1', cents: 8700, months: 3 });
    expect(prisma.giveawayWin.updateMany.mock.calls[0][0].data).toMatchObject({ creditCents: 8700, stripeBalanceTxId: 'cbtxn_1' });
  });

  it('lot Premium annuel : avoir de 3/12 du prix annuel réellement facturé', async () => {
    win = { ...win, pool: GiveawayPool.PREMIUM, prizeMonths: 3 };
    stripe.billingFacts.mockResolvedValue({ paidInvoices: 1, firstPaidAt: new Date(), chargeCents: 49000, interval: 'year' });
    await service.apply('w1', NOW);
    expect(stripe.creditGiveaway.mock.calls[0][0]).toMatchObject({ cents: 12250 });
    expect(resend.send.mock.calls[0][0].html).toContain('de ton prochain renouvellement annuel');
  });

  it('compte plus éligible au moment de l’attribution → FAILED avec la raison, aucun e-mail au gagnant', async () => {
    users.grantGiveawayPremium.mockRejectedValue(new ConflictException('Cet utilisateur a déjà un abonnement Stripe.'));
    expect(await service.apply('w1', NOW)).toEqual({ status: GiveawayActivation.FAILED, error: 'Cet utilisateur a déjà un abonnement Stripe.' });
    expect(prisma.giveawayWin.updateMany.mock.calls[0][0].data).toMatchObject({ activationStatus: GiveawayActivation.FAILED });
    expect(resend.send).not.toHaveBeenCalled();
  });

  it('lot déjà attribué : rien n’est refait (rejeu)', async () => {
    win = { ...win, activationStatus: GiveawayActivation.APPLIED };
    expect(await service.apply('w1', NOW)).toEqual({ status: GiveawayActivation.APPLIED, error: null });
    expect(users.grantGiveawayPremium).not.toHaveBeenCalled();
    expect(prisma.giveawayWin.updateMany).not.toHaveBeenCalled();
  });

  it('compte supprimé entre le tirage et l’attribution → FAILED', async () => {
    win = { ...win, userId: null, user: null };
    expect((await service.apply('w1', NOW)).status).toBe(GiveawayActivation.FAILED);
  });

  it('erreur Stripe ou Prisma : seul le code est gardé, jamais le message brut (identifiants)', async () => {
    win = { ...win, pool: GiveawayPool.PREMIUM, prizeMonths: 3 };
    const stripeErr = Object.assign(new Error("No such customer: 'cus_secret'"), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
    stripe.billingFacts.mockRejectedValueOnce(stripeErr);
    const res = await service.apply('w1', NOW);
    expect(res.error).toBe('Stripe : resource_missing');
    expect(JSON.stringify(prisma.giveawayWin.updateMany.mock.calls)).not.toContain('cus_secret');
    expect(safePrizeError(Object.assign(new Error('SELECT * FROM "User" WHERE email=…'), { name: 'PrismaClientUnknownRequestError' })))
      .toBe('Erreur interne (PrismaClientUnknownRequestError)');
  });
});
