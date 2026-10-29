import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { RegisterComponent } from './register.component';
import { GoogleFinalizeComponent } from './google-finalize.component';
import { AuthService } from '../../core/auth/auth.service';
import { BillingService } from '../../core/services/billing.service';
import { SignupFunnelService } from '../../core/services/signup-funnel.service';
import { OffersStore } from '../../core/stores/offers.store';
import { OfferIntentService } from '../../core/services/offer-intent.service';

// #769 : tout inscrit a 14 jours de Premium offerts. Le lien `/register?plan=premium` (bouton
// « Essayer Premium » de la landing, URL conservée) ne mène plus JAMAIS au paiement : le
// PostSignupService réel est utilisé, seul le paiement est espionné.

const resolveComponentResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() => Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response));
});

const billing = { startCheckout: vi.fn() };
const router = { navigate: vi.fn() };
const auth = {
  isAuthenticated: signal(false),
  currentUser: signal<Record<string, unknown> | null>(null),
  register: vi.fn(() => of({})),
  finalizeGoogleSignup: vi.fn(() => of({ data: {} })),
};

function configure(search: string) {
  window.history.replaceState({}, '', `/register${search}`);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: OffersStore, useValue: { load: vi.fn() } },
      { provide: BillingService, useValue: billing },
      { provide: SignupFunnelService, useValue: { start: vi.fn(), track: vi.fn() } },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(Object.fromEntries(new URLSearchParams(search))) } } },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  for (const c of [RegisterComponent, GoogleFinalizeComponent]) {
    TestBed.overrideComponent(c, { set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string } });
  }
}

describe('Lien plan=premium après l’essai d’inscription (#769)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.currentUser.set(null);
  });

  it('inscription e-mail : tableau de bord, jamais de paiement', async () => {
    configure('?plan=premium');
    await TestBed.compileComponents();
    const c = TestBed.createComponent(RegisterComponent).componentInstance as unknown as Record<string, unknown> & {
      onRegister: () => void;
    };
    (c['email'] as ReturnType<typeof signal<string>>).set('trader@exemple.fr');
    (c['password'] as ReturnType<typeof signal<string>>).set('Motdepasse1');
    (c['confirmPassword'] as ReturnType<typeof signal<string>>).set('Motdepasse1');
    TestBed.inject(OfferIntentService).capture();
    expect(TestBed.inject(OfferIntentService).pending()?.plan).toBe('premium');
    c.onRegister();
    expect(auth.register).toHaveBeenCalled();
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    // Aucune modale d'offres ne s'ouvre ensuite à la place du tableau de bord.
    expect(TestBed.inject(OfferIntentService).pending()).toBeNull();
  });

  it('inscription Google (écran de finalisation) : tableau de bord, jamais de paiement', async () => {
    auth.currentUser.set({ email: 'a@b.c', needsSignupFinalization: true });
    configure('?plan=premium');
    await TestBed.compileComponents();
    const c = TestBed.createComponent(GoogleFinalizeComponent).componentInstance as unknown as { onContinue: () => void };
    TestBed.inject(OfferIntentService).capture();
    c.onContinue();
    expect(billing.startCheckout).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(TestBed.inject(OfferIntentService).pending()).toBeNull();
  });
});
