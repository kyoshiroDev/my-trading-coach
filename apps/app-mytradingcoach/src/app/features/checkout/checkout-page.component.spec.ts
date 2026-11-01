import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CheckoutPageComponent } from './checkout-page.component';
import { BillingService } from '@app/core/services/billing.service';
import { UserStore } from '@app/core/stores/user.store';
import type { CheckoutSummary } from '@app/core/api/billing.api';
import TEMPLATE from './checkout-page.component.html?raw';

// Isolé (NEEDS_ISOLATION) : Stripe.js est remplacé. Les boutons express arrivent après le
// formulaire carte : leur place doit être réservée dès le chargement (#818).
type Handler = (e?: unknown) => void;
const expressHandlers: Record<string, Handler> = {};
const element = () => ({ mount: vi.fn(), destroy: vi.fn() });
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({
    initCheckoutElementsSdk: () => ({
      createPaymentElement: () => element(),
      createExpressCheckoutElement: () => ({
        ...element(),
        on: (name: string, fn: Handler) => { expressHandlers[name] = fn; },
      }),
      // Session jamais chargée : on ne teste ici que la zone express.
      loadActions: () => new Promise(() => undefined),
    }),
  })),
}));

const SUMMARY: CheckoutSummary = {
  offer: 'premium', interval: 'month', recurringEur: 49, normalEur: 49, trialDays: 0,
  partnerCode: null, partnerDurationMonths: null, referralDiscount: false, seatsLeft: null, firstChargeAt: null,
};

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ plan: 'premium_monthly' }) } } },
      {
        provide: BillingService,
        useValue: { createSession: () => of({ data: { clientSecret: 'cs_test_x', publishableKey: 'pk_test_x', summary: SUMMARY } }) },
      },
      { provide: UserStore, useValue: { user: signal({ email: 'trader@example.com' }) } },
    ],
  });
  TestBed.overrideComponent(CheckoutPageComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(CheckoutPageComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      TestBed.tick();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await settle();
  const zone = () => el.querySelector<HTMLElement>('[data-testid="checkout-express"]')!;
  return { el, settle, zone };
}

describe('Page de paiement : zone des boutons express réservée (#818)', () => {
  beforeEach(() => {
    for (const k of Object.keys(expressHandlers)) delete expressHandlers[k];
  });

  it('avant que Stripe ne réponde : zone et séparateur déjà en place, au-dessus du formulaire', async () => {
    const { el, zone } = await mount();
    expect(zone().hidden).toBe(false);
    expect(zone().classList.contains('pending')).toBe(true);
    expect(zone().querySelector('.express-host')).not.toBeNull();
    expect(zone().querySelector('.or')?.textContent).toContain('ou par carte');
    // La zone précède le formulaire carte : réservée, elle ne le pousse plus en arrivant.
    const payment = el.querySelector('.payment')!;
    expect(zone().compareDocumentPosition(payment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Link ou Google Pay disponibles : la zone reste, sans le squelette', async () => {
    const { settle, zone } = await mount();
    expressHandlers['ready']({ availablePaymentMethods: { link: true, googlePay: true, applePay: false } });
    await settle();
    expect(zone().hidden).toBe(false);
    expect(zone().classList.contains('pending')).toBe(false);
  });

  it('aucun moyen express : la zone est retirée (séparateur compris)', async () => {
    const { settle, zone } = await mount();
    expressHandlers['ready']({ availablePaymentMethods: { link: false, googlePay: false, applePay: false } });
    await settle();
    expect(zone().hidden).toBe(true);
  });

  it('échec de chargement des boutons express : la zone est retirée, pas de squelette sans fin', async () => {
    const { settle, zone } = await mount();
    expressHandlers['loaderror']();
    await settle();
    expect(zone().hidden).toBe(true);
  });
});
