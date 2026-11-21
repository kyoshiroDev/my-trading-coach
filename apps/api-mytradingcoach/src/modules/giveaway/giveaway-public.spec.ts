import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { freezeClock } from '../../test/freeze-clock';
import { GIVEAWAY_PUBLIC_CACHE_KEY, GiveawayPublicService } from './giveaway-public.service';

// Le 10 février 2027 (Paris) : prochain tirage le 1er mars, carence = périodes après 2026-08.
const NOW = new Date('2027-02-10T10:00:00Z');
const DAY = 86_400_000;

const settingsRow = { freeEnabled: true, premiumEnabled: false };
const win = (over: Record<string, unknown> = {}) => ({
  id: 'w1', pool: 'FREE', prizeMonths: 1, startsAt: NOW, endsAt: new Date(NOW.getTime() + 28 * DAY),
  activationStatus: 'APPLIED', displayConsent: 'PRENOM_INITIALE', displayPseudo: null, message: 'Merci !',
  moderation: 'EN_ATTENTE', instagramConsent: false, instagramHandle: null, draw: { period: '2027-02' }, ...over,
});

let user: Record<string, unknown>;
const prisma = {
  user: { findUnique: vi.fn(async () => user) },
  giveawayWin: {
    groupBy: vi.fn(async () => [{ pool: 'FREE', _count: { _all: 2 } }, { pool: 'PREMIUM', _count: { _all: 1 } }]),
    aggregate: vi.fn(async () => ({ _sum: { prizeMonths: 5 } })),
    count: vi.fn(async () => 0),
    findFirst: vi.fn(async () => null as unknown),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => win(data)),
  },
  giveawayDraw: {
    findMany: vi.fn(async () => [
      { period: '2027-02', pool: 'FREE', win: { ...win(), user: { name: 'Léa Martin' } } },
      { period: '2027-01', pool: 'FREE', win: { ...win({ displayConsent: 'NONE', message: 'Secret', moderation: 'VALIDE' }), user: { name: 'Paul Durand' } } },
    ]),
  },
};
const settings = { get: vi.fn(async () => settingsRow) };
const eligibility = { countTrades: vi.fn(async () => 3) };
const stripe = { billingFacts: vi.fn() };
const store = new Map<string, string>();
const redis = {
  client: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    del: vi.fn(async (k: string) => { store.delete(k); return 1; }),
  },
};
const service = new GiveawayPublicService(prisma as never, settings as never, eligibility as never, stripe as never, redis as never);

const freeUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1', isDemo: false, isInternal: false, role: Role.USER, plan: 'FREE', createdAt: new Date(NOW.getTime() - 30 * DAY),
  stripeCustomerId: null, stripeSubscriptionId: null, stripeSubscriptionStatus: null, stripeCancelAt: null, stripeInterval: null, ...over,
});

freezeClock(NOW);
beforeEach(() => {
  vi.clearAllMocks();
  eligibility.countTrades.mockResolvedValue(3);
  store.clear();
  settingsRow.freeEnabled = true;
  settingsRow.premiumEnabled = false;
  user = freeUser();
});

describe('état public (landing)', () => {
  it('compteurs réels, nom selon l’accord, message seulement validé', async () => {
    const s = await service.publicState(NOW);
    expect(s).toMatchObject({ enabled: true, free: true, premium: false, winnersFree: 2, winnersPremium: 1, monthsOffered: 5, minTrades: 5 });
    expect(s.nextDrawAt).toBe('2027-03-01T08:00:00.000Z');
    expect(s.winners[0]).toEqual({ period: '2027-02', pool: 'FREE', displayName: 'Léa M.', prizeMonths: 1, message: null });
    expect(s.winners[1]).toMatchObject({ displayName: 'Un trader', message: 'Secret' });
    expect(JSON.stringify(s)).not.toContain('Martin'); // jamais le nom complet
    expect(JSON.stringify(s)).not.toContain('Durand');
  });

  it('mis en cache 60 s puis relu sans requête', async () => {
    await service.publicState(NOW);
    expect(redis.client.set).toHaveBeenCalledWith(GIVEAWAY_PUBLIC_CACHE_KEY, expect.any(String), 'EX', 60);
    prisma.giveawayWin.groupBy.mockClear();
    await service.publicState(NOW);
    expect(prisma.giveawayWin.groupBy).not.toHaveBeenCalled();
  });

  it('tout éteint : enabled false', async () => {
    settingsRow.freeEnabled = false;
    expect((await service.publicState(NOW)).enabled).toBe(false);
  });
});

describe('état de la page (mon statut)', () => {
  it('gratuit avec 3 trades sur 5 : « need_trades » et progression', async () => {
    const s = await service.appState('u1', NOW);
    expect(s.me).toEqual({ pool: 'FREE', reason: 'need_trades', tradesThisMonth: 3 });
    expect(s.demo).toBe(false);
  });

  it('5 trades : « in »', async () => {
    eligibility.countTrades.mockResolvedValueOnce(5);
    expect((await service.appState('u1', NOW)).me.reason).toBe('in');
  });

  it('compte de moins de 7 jours, interne, BETA_TESTER, gagnant récent', async () => {
    user = freeUser({ createdAt: new Date(NOW.getTime() - 3 * DAY) });
    expect((await service.appState('u1', NOW)).me.reason).toBe('account_too_recent');
    user = freeUser({ isInternal: true });
    expect((await service.appState('u1', NOW)).me.reason).toBe('not_eligible');
    user = freeUser({ role: Role.BETA_TESTER });
    expect((await service.appState('u1', NOW)).me.reason).toBe('not_eligible');
    user = freeUser();
    prisma.giveawayWin.count.mockResolvedValueOnce(1);
    expect((await service.appState('u1', NOW)).me.reason).toBe('recent_winner');
  });

  it('même règle que le tirage des gratuits : plan PREMIUM sans abonnement, essai Stripe, paiement en attente → « not_eligible »', async () => {
    eligibility.countTrades.mockResolvedValue(9);
    user = freeUser({ plan: 'PREMIUM' });
    expect((await service.appState('u1', NOW)).me).toMatchObject({ pool: 'FREE', reason: 'not_eligible' });
    user = freeUser({ stripeSubscriptionId: 'sub', stripeSubscriptionStatus: 'trialing' });
    expect((await service.appState('u1', NOW)).me).toMatchObject({ pool: 'FREE', reason: 'not_eligible' });
    user = freeUser({ stripeSubscriptionId: 'sub', stripeSubscriptionStatus: 'past_due' });
    expect((await service.appState('u1', NOW)).me.reason).toBe('not_eligible');
  });

  it('abonné : tirage Premium éteint → « pool_off » ; allumé, moins de 2 mois → « premium_too_recent »', async () => {
    user = freeUser({ stripeSubscriptionId: 'sub', stripeSubscriptionStatus: 'active', stripeCustomerId: 'cus', stripeInterval: 'month' });
    expect((await service.appState('u1', NOW)).me).toMatchObject({ pool: 'PREMIUM', reason: 'pool_off' });
    settingsRow.premiumEnabled = true;
    store.clear(); // allumer depuis l'admin vide le cache public
    stripe.billingFacts.mockResolvedValueOnce({ paidInvoices: 1, firstPaidAt: new Date('2027-01-20'), chargeCents: 4900, interval: 'month' });
    expect((await service.appState('u1', NOW)).me.reason).toBe('premium_too_recent');
  });

  it('abonné avec résiliation programmée : « cancel_scheduled »', async () => {
    settingsRow.premiumEnabled = true;
    user = freeUser({ stripeSubscriptionId: 'sub', stripeSubscriptionStatus: 'active', stripeCustomerId: 'cus', stripeCancelAt: new Date('2027-03-01') });
    expect((await service.appState('u1', NOW)).me.reason).toBe('cancel_scheduled');
  });

  it('démo : page visible, données d’exemple, aucun gagnant ni message', async () => {
    settingsRow.freeEnabled = false;
    user = freeUser({ isDemo: true });
    const s = await service.appState('u1', NOW);
    expect(s).toMatchObject({ demo: true, enabled: true, winners: [], winnersFree: 0, winnersPremium: 0, myWin: null });
  });
});

describe('page gagnant', () => {
  it('sans lot : 404', async () => {
    await expect(service.updateMyWin('u1', { displayConsent: 'NONE', instagramConsent: false }, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('message modifié : repasse « En attente » ; cache public vidé', async () => {
    prisma.giveawayWin.findFirst.mockResolvedValueOnce(win({ moderation: 'VALIDE' }));
    store.set(GIVEAWAY_PUBLIC_CACHE_KEY, '{}');
    await service.updateMyWin('u1', { displayConsent: 'PSEUDO', displayPseudo: ' lea ', message: 'Nouveau', instagramConsent: false }, NOW);
    expect(prisma.giveawayWin.update.mock.calls[0][0].data).toMatchObject({
      displayConsent: 'PSEUDO', displayPseudo: 'lea', message: 'Nouveau', moderation: 'EN_ATTENTE', instagramHandle: null,
    });
    expect(store.has(GIVEAWAY_PUBLIC_CACHE_KEY)).toBe(false);
  });

  it('message inchangé : la modération reste', async () => {
    prisma.giveawayWin.findFirst.mockResolvedValueOnce(win({ moderation: 'VALIDE' }));
    await service.updateMyWin('u1', { displayConsent: 'NONE', message: 'Merci !', instagramConsent: true, instagramHandle: '@lea.trade' }, NOW);
    const data = prisma.giveawayWin.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('moderation');
    expect(data.instagramHandle).toBe('lea.trade');
  });

  it('pseudo requis pour l’affichage par pseudo ; pseudo Instagram invalide refusé', async () => {
    prisma.giveawayWin.findFirst.mockResolvedValue(win());
    await expect(service.updateMyWin('u1', { displayConsent: 'PSEUDO', instagramConsent: false }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateMyWin('u1', { displayConsent: 'NONE', instagramConsent: true, instagramHandle: 'pas bon!' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    prisma.giveawayWin.findFirst.mockReset();
  });
});
