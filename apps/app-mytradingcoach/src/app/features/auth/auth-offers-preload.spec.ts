import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { RegisterComponent } from './register.component';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { BillingService } from '../../core/services/billing.service';
import { SignupFunnelService } from '../../core/services/signup-funnel.service';
import { OffersStore } from '../../core/stores/offers.store';

// #578 : avec un lien d'offre, les offres sont demandées dès l'inscription / la connexion réussie,
// pour être là quand la modale de plans s'ouvre (au lieu d'attendre son ouverture).

const resolveComponentResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() => Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response));
});

const offersStore = { load: vi.fn() };
const auth = {
  isAuthenticated: signal(false),
  register: vi.fn(() => of({})),
  login: vi.fn(() => of({})),
};

function configure(search: string) {
  window.history.replaceState({}, '', `/register${search}`);
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: OffersStore, useValue: offersStore },
      { provide: BillingService, useValue: { startCheckout: vi.fn() } },
      { provide: SignupFunnelService, useValue: { start: vi.fn(), track: vi.fn() } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(Object.fromEntries(new URLSearchParams(search))) } } },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  for (const c of [RegisterComponent, LoginComponent]) {
    TestBed.overrideComponent(c, { set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string } });
  }
}

type Form = Record<'email' | 'password' | 'confirmPassword', ReturnType<typeof signal<string>>> & {
  onRegister: () => void;
  onLogin: () => void;
};

async function submitRegister(search: string) {
  configure(search);
  await TestBed.compileComponents();
  const c = TestBed.createComponent(RegisterComponent).componentInstance as unknown as Form;
  c.email.set('trader@exemple.fr');
  c.password.set('Motdepasse1');
  c.confirmPassword.set('Motdepasse1');
  c.onRegister();
}

async function submitLogin(search: string) {
  configure(search);
  await TestBed.compileComponents();
  const c = TestBed.createComponent(LoginComponent).componentInstance as unknown as Form;
  c.email.set('trader@exemple.fr');
  c.password.set('Motdepasse1');
  c.onLogin();
}

describe('Offres demandées dès l’inscription / la connexion (#578)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('inscription par le lien fondateur : offres demandées dès la réponse', async () => {
    await submitRegister('?plan=founder&cta=carte');
    expect(auth.register).toHaveBeenCalled();
    expect(offersStore.load).toHaveBeenCalledOnce();
  });

  it('inscription sans lien d’offre : rien de plus', async () => {
    await submitRegister('');
    expect(auth.register).toHaveBeenCalled();
    expect(offersStore.load).not.toHaveBeenCalled();
  });

  it('connexion avec une intention fondateur en attente : offres demandées', async () => {
    sessionStorage.setItem('mtc_offer_intent', JSON.stringify({ plan: 'founder', promo: null, cta: 'carte' }));
    await submitLogin('');
    expect(auth.login).toHaveBeenCalled();
    expect(offersStore.load).toHaveBeenCalledOnce();
  });

  it('connexion sans intention : rien de plus', async () => {
    await submitLogin('');
    expect(offersStore.load).not.toHaveBeenCalled();
  });
});
