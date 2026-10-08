import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import { FOUNDER_OFFER } from '@mtc/shared';
import { FounderOfferService, RESERVATION_TTL_MS } from './founder-offer.service';

/** Éligibilité, compteur, remboursement : base simulée (la concurrence réelle est en int-spec). */
function setup(over: { config?: object; seat?: object | null; taken?: number; reservations?: number } = {}) {
  const prisma = {
    founderOfferConfig: {
      findUnique: vi.fn().mockResolvedValue({ id: 1, open: true, endsAt: null, notifiedMilestones: [], ...over.config }),
      create: vi.fn(),
      update: vi.fn(async ({ data }) => ({ id: 1, ...data })),
    },
    founderSeat: {
      findUnique: vi.fn().mockResolvedValue(over.seat ?? null),
      count: vi.fn().mockResolvedValue(over.taken ?? 0),
      update: vi.fn(async ({ data }) => ({ ...(over.seat ?? {}), ...data })),
    },
    checkoutReservation: { count: vi.fn().mockResolvedValue(over.reservations ?? 0) },
  };
  const redis = { client: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) } };
  const service = new FounderOfferService(prisma as never, redis as never);
  return { service, prisma, redis };
}

const user = (o: Partial<{ role: Role; isDemo: boolean; stripeSubscriptionStatus: string | null; stripePriceId: string | null }> = {}) => ({
  id: 'u1', role: Role.USER, isDemo: false, stripeSubscriptionStatus: null, stripePriceId: null, ...o,
});
const FOUNDER_PRICES = ['price_f_m', 'price_f_y'];

describe('FounderOfferService.eligibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offre ouverte, gratuit sans abonnement → éligible', async () => {
    expect(await setup().service.eligibility(user(), FOUNDER_PRICES)).toEqual({ eligible: true, reason: null });
  });

  it('offre fermée par l’interrupteur ou date de fin passée → closed', async () => {
    expect((await setup({ config: { open: false } }).service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('closed');
    const past = new Date(Date.now() - 1000);
    expect((await setup({ config: { endsAt: past } }).service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('closed');
  });

  it('plus de place (places + réservations) → sold_out', async () => {
    const { service } = setup({ taken: FOUNDER_OFFER.seats - 1, reservations: 1 });
    expect((await service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('sold_out');
  });

  it('démo, ADMIN, BETA_TESTER → excluded ; une AMBASSADRICE reste éligible', async () => {
    const { service } = setup();
    expect((await service.eligibility(user({ isDemo: true }), FOUNDER_PRICES)).reason).toBe('excluded');
    expect((await service.eligibility(user({ role: Role.ADMIN }), FOUNDER_PRICES)).reason).toBe('excluded');
    expect((await service.eligibility(user({ role: Role.BETA_TESTER }), FOUNDER_PRICES)).reason).toBe('excluded');
    expect((await service.eligibility(user({ role: Role.AMBASSADOR }), FOUNDER_PRICES)).eligible).toBe(true);
  });

  it('déjà fondateur → already_founder ; tarif perdu ou remboursé → tariff_lost (définitif)', async () => {
    expect((await setup({ seat: { status: 'ACTIVE' } }).service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('already_founder');
    expect((await setup({ seat: { status: 'LOST' } }).service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('tariff_lost');
    expect((await setup({ seat: { status: 'REFUNDED' } }).service.eligibility(user(), FOUNDER_PRICES)).reason).toBe('tariff_lost');
  });

  it('abonné payant au prix normal → subscribed ; essai au prix normal ou mois offert → peut basculer', async () => {
    const { service } = setup();
    expect((await service.eligibility(user({ stripeSubscriptionStatus: 'active', stripePriceId: 'price_49' }), FOUNDER_PRICES)).reason).toBe('subscribed');
    expect((await service.eligibility(user({ stripeSubscriptionStatus: 'past_due', stripePriceId: 'price_49' }), FOUNDER_PRICES)).reason).toBe('subscribed');
    expect((await service.eligibility(user({ stripeSubscriptionStatus: 'trialing', stripePriceId: 'price_49' }), FOUNDER_PRICES)).eligible).toBe(true);
    expect((await service.eligibility(user({ stripeSubscriptionStatus: null }), FOUNDER_PRICES)).eligible).toBe(true);
  });
});

describe('FounderOfferService — compteur et état public', () => {
  it('places restantes = 200 − (places prises + réservations), jamais négatif', async () => {
    expect(await setup({ taken: 150, reservations: 3 }).service.seatsLeft()).toBe(47);
    expect(await setup({ taken: 201 }).service.seatsLeft()).toBe(0);
  });

  it('valeur en cache (30 s) servie sans requête', async () => {
    const { service, prisma, redis } = setup();
    redis.client.get.mockResolvedValueOnce('12');
    expect(await service.seatsLeft()).toBe(12);
    expect(prisma.founderSeat.count).not.toHaveBeenCalled();
  });

  it('état public : aucune donnée personnelle, open=false si fermée', async () => {
    const state = await setup({ config: { open: false } }).service.publicState();
    expect(state).toEqual({
      open: false, ended: false, seatsTotal: 200, seatsLeft: 200,
      priceMonthlyEur: FOUNDER_OFFER.priceMonthlyEur, priceAnnualEur: FOUNDER_OFFER.priceAnnualEur,
    });
  });

  it('ouverte puis complète ou terminée → ended (FAQ « offre clôturée »)', async () => {
    const full = await setup({ taken: FOUNDER_OFFER.seats }).service.publicState();
    expect(full).toMatchObject({ open: false, ended: true, seatsLeft: 0 });
    const past = await setup({ config: { endsAt: new Date(Date.now() - 1000) } }).service.publicState();
    expect(past).toMatchObject({ open: false, ended: true });
    expect(await setup().service.publicState()).toMatchObject({ open: true, ended: false });
  });

  it('réservation de 35 min : couvre la session Stripe de 30 min et le webhook', () => {
    expect(RESERVATION_TTL_MS).toBe(35 * 60_000);
  });
});

describe('FounderOfferService.refundFirstPayment — remboursement intégral, quel que soit le délai', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('premier paiement il y a 10 jours → REFUNDED (place rendue, tarif perdu)', async () => {
    const { service, prisma } = setup({ seat: { number: 7, status: 'ACTIVE', takenAt: new Date('2026-10-10T12:00:00Z') } });
    const seat = await service.refundFirstPayment('u1', now);
    expect(prisma.founderSeat.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { number: 7 }, data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(seat?.status).toBe('REFUNDED');
  });

  it('remboursé au 15e jour (demande faite au 13e) → place rendue quand même', async () => {
    const { service } = setup({ seat: { number: 7, status: 'ACTIVE', takenAt: new Date('2026-10-05T12:00:00Z') } });
    expect((await service.refundFirstPayment('u1', now))?.status).toBe('REFUNDED');
  });

  it('place déjà terminée (perdue ou remboursée) → rien ne change', async () => {
    const lost = setup({ seat: { number: 7, status: 'LOST', takenAt: new Date('2026-10-15T12:00:00Z') } });
    expect(await lost.service.refundFirstPayment('u1', now)).toBeNull();
    expect(lost.prisma.founderSeat.update).not.toHaveBeenCalled();
  });
});
