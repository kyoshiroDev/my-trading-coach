import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { of } from 'rxjs';
import { PlanModalComponent, partnerDurationLabel } from './plan-modal.component';
import { BillingApi, type BillingOffers } from '@app/core/api/billing.api';
import { BillingService } from '@app/core/services/billing.service';
import { OffersStore } from '@app/core/stores/offers.store';
import type { OfferIntent } from '@app/core/services/offer-intent.service';

// Offre fondateur et code partenaire dans la modale (#525) : présélection selon le lien, choix
// explicite, jamais de cumul, `cta` et `promo` transmis au checkout.

const resolveComponentResources = (
  angularCore as Record<string, unknown>
)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() =>
    Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response),
  );
});

const LOUIS29 = {
  valid: true as const, code: 'LOUIS29', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, label: '',
};

function offers(founderOpen: boolean): BillingOffers {
  return {
    founderOffer: { open: founderOpen, seatsLeft: 163, seatsTotal: 200 },
    founder: {
      isFounder: false, number: null, interval: null, since: null,
      eligible: founderOpen, ineligibleReason: founderOpen ? null : 'closed', refundUntil: null,
    },
    partner: null,
    subscription: { interval: null, status: null },
  };
}

// La modale ouvre la page de paiement (BillingService.startCheckout) : c'est ce qu'on vérifie.
const billingService = { startCheckout: vi.fn() };

const billingApi = {
  checkout: vi.fn().mockReturnValue(of({ data: { url: 'https://checkout.stripe.test/s' } })),
  offers: vi.fn(),
  validatePartnerCode: vi.fn(),
};

type ModalApi = {
  choice: () => string;
  pick: (c: string) => void;
  setInterval: (i: string) => void;
  onCodeInput: (v: string) => void;
  confirmPlan: () => void;
  validation: () => { valid: boolean; message?: string } | null;
  showsBoth: () => boolean;
};

async function setup(opts: { founderOpen: boolean; preset?: OfferIntent | null; cta?: string }) {
  const store = signal<BillingOffers | null>(offers(opts.founderOpen));
  const fakeStore = {
    offers: store,
    founderAvailable: computed(() => {
      const o = store();
      return !!o && o.founderOffer.open && o.founderOffer.seatsLeft > 0 && o.founder.eligible;
    }),
    isFounder: computed(() => false),
    partner: computed(() => null),
    load: vi.fn(),
    refresh: vi.fn(),
  };
  TestBed.configureTestingModule({
    imports: [PlanModalComponent],
    providers: [
      { provide: BillingApi, useValue: billingApi },
      { provide: BillingService, useValue: billingService },
      { provide: OffersStore, useValue: fakeStore },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(PlanModalComponent, {
    set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(PlanModalComponent);
  // En JIT (vitest), les entrées signal ne sont pas affectables par setInput : on remplace les
  // signaux d'entrée AVANT la première détection (ngOnInit lit `preset`).
  const inputs = fixture.componentInstance as unknown as Record<string, unknown>;
  inputs['preset'] = signal(opts.preset ?? null);
  inputs['cta'] = signal(opts.cta ?? 'modale');
  fixture.detectChanges();
  return fixture.componentInstance as unknown as ModalApi;
}

describe('PlanModal — offre fondateur et code partenaire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    billingApi.checkout.mockReturnValue(of({ data: { url: 'https://checkout.stripe.test/s' } }));
    billingApi.validatePartnerCode.mockReturnValue(of({ data: LOUIS29 }));
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('fondateur accessible, sans lien : présélectionné, checkout au prix fondateur', async () => {
    const c = await setup({ founderOpen: true });
    expect(c.choice()).toBe('founder');
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('founder_monthly', { cta: 'modale', promo: null });
  });

  it('annuel fondateur → founder_yearly', async () => {
    const c = await setup({ founderOpen: true });
    c.setInterval('yearly');
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('founder_yearly', { cta: 'modale', promo: null });
  });

  it('lien plan=founder ET promo valide : le code est présélectionné, le fondateur reste à côté', async () => {
    const c = await setup({ founderOpen: true, preset: { plan: 'founder', promo: 'LOUIS29', cta: 'bandeau' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(c.choice()).toBe('partner');
    expect(c.showsBoth()).toBe(true);
    c.confirmPlan();
    // Prix NORMAL + code : la remise est appliquée par l'API (coupon), jamais sur un prix fondateur.
    expect(billingService.startCheckout).toHaveBeenCalledWith('premium_monthly', { cta: 'bandeau', promo: 'LOUIS29' });
  });

  it('jamais de cumul : choisir le fondateur n’envoie pas le code', async () => {
    const c = await setup({ founderOpen: true, preset: { plan: 'founder', promo: 'LOUIS29', cta: 'bandeau' } });
    await vi.advanceTimersByTimeAsync(500);
    c.pick('founder');
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('founder_monthly', { cta: 'bandeau', promo: null });
  });

  it('code du lien refusé : raison affichée, présélection fondateur', async () => {
    billingApi.validatePartnerCode.mockReturnValue(
      of({ data: { valid: false, code: 'LOUIS29', reason: 'exhausted', message: 'Ce code partenaire a atteint son nombre maximum de personnes.' } }),
    );
    const c = await setup({ founderOpen: true, preset: { plan: 'founder', promo: 'LOUIS29', cta: 'carte' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(c.validation()?.message).toContain('nombre maximum');
    expect(c.choice()).toBe('founder');
  });

  it('offre fermée : code saisi à la main et valide → choisi automatiquement', async () => {
    const c = await setup({ founderOpen: false });
    expect(c.choice()).toBe('premium');
    c.onCodeInput('louis29');
    await vi.advanceTimersByTimeAsync(500);
    expect(billingApi.validatePartnerCode).toHaveBeenCalledWith('LOUIS29');
    expect(c.choice()).toBe('partner');
    c.setInterval('yearly');
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('premium_yearly', { cta: 'modale', promo: 'LOUIS29' });
  });

  it('point de clic de l’écran (cadenas, profil) transmis au checkout', async () => {
    const c = await setup({ founderOpen: true, cta: 'cadenas' });
    c.confirmPlan();
    expect(billingService.startCheckout).toHaveBeenCalledWith('founder_monthly', { cta: 'cadenas', promo: null });
  });
});

describe('partnerDurationLabel', () => {
  it('à vie, ou N mois puis prix normal de l’intervalle', () => {
    expect(partnerDurationLabel(null, 'monthly')).toBe('à vie');
    expect(partnerDurationLabel(3, 'monthly')).toBe('pendant 3 mois, puis 49 €/mois');
    expect(partnerDurationLabel(3, 'yearly')).toBe('pendant 3 mois, puis 490 €/an');
  });
});
