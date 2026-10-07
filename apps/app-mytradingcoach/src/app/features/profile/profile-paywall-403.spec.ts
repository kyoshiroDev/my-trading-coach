/**
 * le 403 attendu du paywall ne doit plus remonter en erreur non gérée.
 *
 * Constat navigateur : en FREE, l'écran Profil appelle
 * `GET /analytics/by-setup` (endpoint Premium) ; sans gestionnaire d'erreur, RxJS
 * remontait un `ERROR HttpErrorResponse` en console. Invisible pour l'utilisateur,
 * mais ça noie les vraies erreurs au diagnostic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, Observable, of, throwError } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';

/** Monte le vrai écran Profil, avec un `by-setup` qui échoue comme en FREE. */
function mount(bySetup: Observable<unknown>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          user: () => ({ currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: false }),
          isPremium: () => false, isDemo: () => false, isInTrial: () => false,
          displayName: () => 'Test', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { currentUser: signal(null), setCurrentUser: vi.fn() } },
      // Offres (#525) : aucune, la section Abonnement reste celle d'avant.
      { provide: BillingApi, useValue: { offers: () => EMPTY } },
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })) } },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => bySetup) } },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges(); // déclenche ngOnInit → appel by-setup
  return fixture;
}

describe('ProfileComponent — by-setup (endpoint Premium) en compte FREE', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it('403 (paywall attendu) → aucune erreur en console, écran non cassé', () => {
    const fixture = mount(throwError(() => ({ status: 403, message: 'Forbidden' })));

    expect(
      consoleError,
      'Un 403 attendu du paywall ne doit pas polluer la console',
    ).not.toHaveBeenCalled();
    const cmp = fixture.componentInstance as any;
    expect(cmp.setupStats(), 'Le win rate par setup est simplement omis').toEqual([]);
  });

  it('500 (vraie panne) → reste signalé', () => {
    mount(throwError(() => ({ status: 500, message: 'Boom' })));

    expect(
      consoleError,
      'On ne filtre que le cas paywall connu, jamais les vraies erreurs',
    ).toHaveBeenCalled();
  });

  it('réponse OK → les stats alimentent l\'écran', () => {
    const fixture = mount(of({ data: [{ setupId: 's1', winRate: 62 }] }));

    const cmp = fixture.componentInstance as any;
    expect(cmp.setupStats()).toEqual([{ setupId: 's1', winRate: 62 }]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
