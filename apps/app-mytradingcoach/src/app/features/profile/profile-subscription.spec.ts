/**
 * Bloc Profil > Abonnement : un Premium offert par l'admin (aucun abonnement Stripe) ne doit
 * pas afficher le message d'essai Stripe ni le bouton du portail (qui échouerait, pas de client
 * Stripe) ; il propose de continuer en Premium via la modale de plans.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';

// Vrai template (le bloc testé), CSS ignoré.
const TEMPLATE = readFileSync(join(__dirname, 'profile.component.html'), 'utf8');

const IN_20_DAYS = new Date(Date.now() + 20 * 86_400_000).toISOString();

function render(opts: { offered: boolean }) {
  const user = {
    email: 'louis@test.com', plan: 'FREE', trialEndsAt: IN_20_DAYS, trialUsed: true,
    stripeSubscriptionStatus: opts.offered ? null : 'trialing',
    notificationsEmail: true, debriefAutomatic: true, marketingConsent: false,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ tab: 'params' })), snapshot: { queryParamMap: convertToParamMap({ tab: 'params' }) } } },
      {
        provide: UserStore,
        useValue: {
          user: () => user,
          isPremium: () => true, isDemo: () => false, isOfferedPremium: () => opts.offered,
          trialAvailable: () => false,
          displayName: () => 'Louis', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { currentUser: signal(user), setCurrentUser: vi.fn() } },
      { provide: BillingApi, useValue: {} },
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })) } },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => of({ data: [] })) } },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, { set: {
      template: TEMPLATE, imports: [DatePipe, DecimalPipe], schemas: [NO_ERRORS_SCHEMA],
      styleUrls: [], styleUrl: undefined as unknown as string,
    }, });
  const fixture = TestBed.createComponent(ProfileComponent);
  (fixture.componentInstance as unknown as { activeProfileTab: { set(v: string): void } }).activeProfileTab.set('params');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Profil > Abonnement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Premium offert : jours restants, aucun prélèvement, pas de portail Stripe', () => {
    const text = render({ offered: true }).textContent ?? '';
    expect(text).toContain('🎁 Premium offert : il te reste 20 jours');
    expect(text).toContain('Aucun prélèvement, tu repasses en gratuit automatiquement.');
    expect(text).toContain('Continuer en Premium →');
    expect(text).not.toContain('Premier prélèvement');
    expect(text).not.toContain('annuler mon essai');
    expect(text).not.toContain('Gérer mon abonnement');
  });

  it('Essai Stripe : comportement inchangé (premier prélèvement + portail)', () => {
    const text = render({ offered: false }).textContent ?? '';
    expect(text).toContain('🎁 Essai gratuit : il te reste 20 jours');
    expect(text).toContain('Premier prélèvement le');
    expect(text).toContain('Gérer / annuler mon essai →');
    expect(text).not.toContain('Premium offert');
  });
});
