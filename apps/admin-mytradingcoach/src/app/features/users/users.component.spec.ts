import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { UsersComponent } from './users.component';
import type { AdminUser } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

/** Liste Utilisateurs filtrée par campagne (#625) : l'URL porte le filtre, la liste le relaie à l'API. */
const USERS_URL = `${environment.apiUrl}/admin/users`;
const DAY = 86_400_000;

function user(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1', email: 'a@test.local', name: 'A', plan: 'FREE', role: 'USER',
    trialEndsAt: null, stripeInterval: null, stripeCurrentPeriodEnd: null,
    lastSeenAt: null, lastLoginAt: null, createdAt: '2026-10-18T10:00:00.000Z',
    ...over,
  };
}

let query: BehaviorSubject<ParamMap>;

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: query } },
    ],
  });
  const fixture = TestBed.createComponent(UsersComponent);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(`${USERS_URL}/stats`).flush({ data: null });
  return { fixture, http };
}

async function flushList(fixture: ReturnType<typeof setup>['fixture'], http: HttpTestingController, users: AdminUser[]) {
  const req = http.expectOne((r) => r.url === USERS_URL);
  req.flush({ data: { users, total: users.length } });
  await fixture.whenStable();
  fixture.detectChanges();
  return req.request.params;
}

describe('UsersComponent — inscrits d’une campagne', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    query = new BehaviorSubject(convertToParamMap({}));
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('sans filtre : aucun paramètre UTM, pas de bandeau', async () => {
    const { fixture, http } = setup();
    const params = await flushList(fixture, http, [user()]);
    expect(params.has('campaign')).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-testid="utm-filter"]')).toBeNull();
  });

  it('?source=&medium=&campaign= → relayés à l’API, bandeau avec le nombre d’inscrits', async () => {
    query.next(convertToParamMap({ source: 'instagram', medium: 'dm', campaign: 'Exemple' }));
    const { fixture, http } = setup();
    const params = await flushList(fixture, http, [user(), user({ id: 'u2', email: 'b@test.local' })]);
    expect(params.get('source')).toBe('instagram');
    expect(params.get('medium')).toBe('dm');
    expect(params.get('campaign')).toBe('exemple');
    const banner = fixture.nativeElement.querySelector('[data-testid="utm-filter"]') as HTMLElement;
    expect(banner.textContent).toContain('instagram · dm · exemple');
    expect(banner.textContent).toContain('2 inscrits');
  });

  it('changement de filtre dans l’URL → liste rechargée', async () => {
    const { fixture, http } = setup();
    await flushList(fixture, http, []);
    query.next(convertToParamMap({ campaign: 'exemple' }));
    const params = await flushList(fixture, http, [user()]);
    expect(params.get('campaign')).toBe('exemple');
    expect(params.has('source')).toBe(false);
  });

  it('mois offert (FREE + fin future) : badge « Offert » dans la colonne Abonnement', async () => {
    const { fixture, http } = setup();
    await flushList(fixture, http, [
      user({ trialEndsAt: new Date(Date.now() + 10 * DAY).toISOString() }),
      user({ id: 'u2', email: 'b@test.local', trialEndsAt: new Date(Date.now() - DAY).toISOString() }),
    ]);
    const badges = [...fixture.nativeElement.querySelectorAll('.sub-badge')].map((b) => (b as HTMLElement).textContent?.trim());
    expect(badges).toEqual(['Offert']);
  });

  it('essai d’inscription : badge « Essai » distinct, « Offert » réservé au Premium offert par l’admin (#769)', async () => {
    const { fixture, http } = setup();
    const soon = new Date(Date.now() + 10 * DAY).toISOString();
    await flushList(fixture, http, [
      user({ trialEndsAt: soon, trialSource: 'SIGNUP' }),
      user({ id: 'u2', email: 'b@test.local', trialEndsAt: soon, trialSource: 'ADMIN' }),
      user({ id: 'u3', email: 'c@test.local', trialEndsAt: new Date(Date.now() - DAY).toISOString(), trialSource: 'SIGNUP' }),
      user({ id: 'u4', email: 'd@test.local' }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const badges = [...el.querySelectorAll('.sub-badge')].map((b) => (b as HTMLElement).textContent?.trim());
    expect(badges).toEqual(['Essai', 'Offert']);
    expect(el.querySelectorAll('[data-testid="badge-signup-trial"]')).toHaveLength(1);
    expect(el.querySelector('[data-testid="badge-signup-trial"]')?.getAttribute('title')).toContain("Essai d'inscription jusqu'au");
  });

  it('état réel de l’abonnement (#813) : payé pendant l’essai = mensuel, réservation = essai, pause = « En pause »', async () => {
    const { fixture, http } = setup();
    const soon = new Date(Date.now() + DAY).toISOString();
    await flushList(fixture, http, [
      // 3. réservation à moins de 48 h, payée : essai d'inscription encore futur, abonnement actif.
      user({ plan: 'PREMIUM', trialEndsAt: soon, trialSource: 'SIGNUP', stripeSubscriptionStatus: 'active', stripeInterval: 'month' }),
      // 2. réservation fondateur pendant l'essai.
      user({ id: 'u2', email: 'b@test.local', plan: 'PREMIUM', trialEndsAt: soon, trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeInterval: 'month' }),
      // 6. en pause : plan FREE.
      user({ id: 'u3', email: 'c@test.local', plan: 'FREE', stripeSubscriptionStatus: 'past_due', stripeInterval: 'month' }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const badges = [...el.querySelectorAll('.sub-badge')].map((b) => (b as HTMLElement).textContent?.trim());
    expect(badges).toEqual(['Mensuel', 'Essai', 'En pause']);
    expect(el.querySelectorAll('[data-testid="badge-paused"]')).toHaveLength(1);
  });

  it('annulation programmée (#813, état 5) : « Essai annulé » ou « Résilié », date de fin en info-bulle, comme la fiche', async () => {
    const { fixture, http } = setup();
    const soon = new Date(Date.now() + DAY).toISOString();
    await flushList(fixture, http, [
      // 5. réservation pendant l'essai, annulée : fin programmée.
      user({ plan: 'PREMIUM', trialEndsAt: soon, trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeInterval: 'month', stripeCurrentPeriodEnd: soon, stripeCancelAt: '2099-11-12T08:00:00.000Z' }),
      // Abonnement payant résilié en fin de période.
      user({ id: 'u2', email: 'b@test.local', plan: 'PREMIUM', stripeSubscriptionStatus: 'active', stripeInterval: 'year', stripeCancelAt: '2099-11-12T08:00:00.000Z' }),
      // 2. réservation non annulée : toujours « Essai ».
      user({ id: 'u3', email: 'c@test.local', plan: 'PREMIUM', stripeSubscriptionStatus: 'trialing', stripeInterval: 'month', stripeCurrentPeriodEnd: soon }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const badges = [...el.querySelectorAll('.sub-badge')].map((b) => (b as HTMLElement).textContent?.trim());
    expect(badges).toEqual(['Essai annulé', 'Résilié', 'Essai']);
    expect(el.querySelector('[data-testid="badge-canceled"]')?.getAttribute('title')).toBe('Fin le 12/11/2099, aucun prélèvement');
    expect(el.querySelector('[data-testid="badge-ended"]')?.getAttribute('title')).toBe('Fin le 12/11/2099, aucun prélèvement');
    expect(el.querySelector('[data-testid="badge-trial"]')?.getAttribute('title')).toBeNull();
  });

  it('pause (past_due) pendant l’essai d’inscription : « En pause » seul, sans badge « Essai » (même lecture que la fiche)', async () => {
    const { fixture, http } = setup();
    await flushList(fixture, http, [
      user({ plan: 'FREE', trialEndsAt: new Date(Date.now() + 10 * DAY).toISOString(), trialSource: 'SIGNUP', stripeSubscriptionStatus: 'past_due', stripeInterval: 'month' }),
    ]);
    const el = fixture.nativeElement as HTMLElement;
    const badges = [...el.querySelectorAll('.sub-badge')].map((b) => (b as HTMLElement).textContent?.trim());
    expect(badges).toEqual(['En pause']);
    expect(el.querySelector('[data-testid="badge-signup-trial"]')).toBeNull();
  });
});
