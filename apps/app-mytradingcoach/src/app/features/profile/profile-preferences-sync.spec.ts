/**
 * F14 (#1047) : l'effet de synchronisation réécrivait les trois cases e-mail à chaque nouvel objet
 * utilisateur, y compris la relecture de /auth/me toutes les 5 min. Une case décochée et pas encore
 * enregistrée revenait cochée en silence, et c'est l'ancienne valeur qui partait.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EMPTY, of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';
import TEMPLATE from './profile.component.html?raw';

type Prefs = { currency: string; notificationsEmail: boolean; debriefAutomatic: boolean; marketingConsent: boolean };

function mount() {
  const user = signal<Prefs>({ currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: true });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      {
        provide: UserStore,
        useValue: {
          user, isPremium: () => false, isDemo: () => false, isInTrial: () => false,
          displayName: () => 'Test', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { currentUser: signal(null), setCurrentUser: vi.fn(), logout: vi.fn() } },
      { provide: BillingApi, useValue: { offers: () => EMPTY } },
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })) } },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => of({ data: [] })) } },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance as any, user };
}

describe('Profil : préférences e-mail non enregistrées (F14 #1047)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('relecture du compte (nouvel objet, mêmes valeurs) : la case décochée le reste', () => {
    const { fixture, cmp, user } = mount();
    expect(cmp.prefMarketing()).toBe(true);

    cmp.prefMarketing.set(false); // décochée, pas encore « Sauvegarder »
    user.set({ ...user() }); // /auth/me toutes les 5 min : nouvel objet identique
    fixture.detectChanges();

    expect(cmp.prefMarketing()).toBe(false);
  });

  it('valeur changée côté serveur (autre appareil) : la case suit', () => {
    const { fixture, cmp, user } = mount();
    user.set({ ...user(), notificationsEmail: false });
    fixture.detectChanges();
    expect(cmp.prefNotifications()).toBe(false);
  });
});

// N1 (#1048) : la case couvre aussi le récap du soir (17h30), qui la respecte désormais.
describe('Profil : texte de « Notifications email » (N1 #1048)', () => {
  it('nomme les débriefs hebdo, les récaps du soir et les alertes importantes', () => {
    expect(TEMPLATE).toContain('Débriefs hebdo, récaps du soir et alertes importantes');
  });
});
