import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// formulaire carte : leur place doit être réservée dès le chargement (#818). Le formulaire, le total
// et le bouton n'apparaissent qu'une fois le formulaire de hauteur stable (#829).
type Handler = (e?: unknown) => void;
const expressHandlers: Record<string, Handler> = {};
const paymentHandlers: Record<string, Handler> = {};
const element = (handlers: Record<string, Handler>) => ({
  mount: vi.fn(), destroy: vi.fn(),
  on: (name: string, fn: Handler) => { handlers[name] = fn; },
});
/** Session Stripe : chargée seulement quand le test appelle `loadSession()`. */
let loadSession: () => void = () => undefined;
const SESSION = { email: null, total: { total: { minorUnitsAmount: 4900 } } };
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({
    initCheckoutElementsSdk: () => ({
      createPaymentElement: () => element(paymentHandlers),
      createExpressCheckoutElement: () => element(expressHandlers),
      loadActions: () => new Promise((resolve) => {
        loadSession = () => resolve({ type: 'success', actions: { getSession: () => SESSION, confirm: vi.fn() } });
      }),
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
  return { el, settle, zone, fixture };
}

const reset = () => {
  for (const h of [expressHandlers, paymentHandlers]) for (const k of Object.keys(h)) delete h[k];
  loadSession = () => undefined;
};

describe('Page de paiement : zone des boutons express réservée (#818)', () => {
  beforeEach(reset);

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

describe('Page de paiement : formulaire affiché une fois posé (#829)', () => {
  beforeEach(reset);
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const zone = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="checkout-pay-zone"]')!;
  const loading = (el: HTMLElement) => el.querySelector('[data-testid="checkout-loading"]');

  it('pendant le chargement : formulaire, total et bouton masqués, message par-dessus, avantages masqués', async () => {
    const { el } = await mount();
    expect(zone(el).classList.contains('settling')).toBe(true);
    expect(loading(el)?.textContent).toContain('Préparation du paiement');
    // Le total et le bouton sont déjà dans la page (place prise), mais invisibles.
    expect(zone(el).querySelector('[data-testid="checkout-pay"]')).not.toBeNull();
    expect(el.querySelector('.grid')!.classList.contains('settling')).toBe(true);
    expect(el.querySelector('.head')!.classList.contains('head-pending')).toBe(false); // récapitulatif déjà là
  });

  it('session chargée mais formulaire Stripe pas encore prêt : toujours masqué', async () => {
    const { el, settle } = await mount();
    loadSession();
    await settle();
    expect(zone(el).classList.contains('settling')).toBe(true);
  });

  it('session chargée et formulaire prêt : tout apparaît d’un coup', async () => {
    const { el, settle } = await mount();
    loadSession();
    await settle();
    paymentHandlers['ready']();
    await settle();
    expect(zone(el).classList.contains('settling')).toBe(false);
    expect(loading(el)).toBeNull();
    expect(el.querySelector('.grid')!.classList.contains('settling')).toBe(false);
    expect(el.querySelector('[data-testid="checkout-today"]')?.textContent).toContain('49,00');
  });

  /** Attente « hauteur stable » appelée directement, avec un faux ResizeObserver et une horloge simulée. */
  async function settleWatcher() {
    let resized: () => void = () => undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resized = cb; }
      observe() { /* rien */ }
      disconnect() { /* rien */ }
    });
    const { fixture } = await mount();
    vi.useFakeTimers();
    let done = false;
    const watcher = (fixture.componentInstance as unknown as { formSettled: (el: HTMLElement) => Promise<void> })
      .formSettled(document.createElement('div'));
    void watcher.then(() => { done = true; });
    return { resize: () => resized(), isDone: () => done, advance: (ms: number) => vi.advanceTimersByTimeAsync(ms) };
  }

  it('formulaire encore redimensionné par Stripe : attend 1,2 s sans changement de hauteur', async () => {
    const w = await settleWatcher();
    await w.advance(1000);
    w.resize(); // 344 → 416 px : le compte repart de zéro
    await w.advance(1000);
    expect(w.isDone()).toBe(false);
    await w.advance(250);
    expect(w.isDone()).toBe(true);
  });

  it('Stripe n’arrête pas de redimensionner : affiché quand même au bout de 5 s', async () => {
    const w = await settleWatcher();
    for (let i = 0; i < 9; i++) { await w.advance(500); w.resize(); }
    expect(w.isDone()).toBe(false); // 4,5 s
    await w.advance(600);
    expect(w.isDone()).toBe(true);
  });
});
