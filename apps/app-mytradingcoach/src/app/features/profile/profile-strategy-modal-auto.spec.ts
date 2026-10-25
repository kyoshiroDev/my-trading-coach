/**
 * Régression — la modale « Modifier ma stratégie » masquait la section Notifications.
 *
 * Au premier passage (aucune stratégie renseignée), le Profil ouvre la modale tout seul.
 * En arrivant d'une notification push (`/profil#notifications`, test réel du 25/10 sur dev),
 * elle recouvrait la section que la notification venait ouvrir ; même chose pour le lien
 * « Gérer mes e-mails » (`/profil?tab=params`). Sur ces liens profonds, plus d'ouverture
 * automatique ; sur `/profil` nu, comportement inchangé (le bandeau « Compléter » du tableau
 * de bord compte dessus).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
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

function mount(opts: {
  fragment: string | null;
  query?: Record<string, string>;
  strategy?: { tradingStyle?: string; strategyDescription?: string };
}) {
  const params = convertToParamMap(opts.query ?? {});
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { fragment: opts.fragment, queryParamMap: params }, queryParamMap: of(params) } },
      {
        provide: UserStore,
        useValue: {
          user: () => ({ currency: 'EUR', notificationsEmail: true, debriefAutomatic: true, marketingConsent: false, ...opts.strategy }),
          isPremium: () => false, isDemo: () => false, isInTrial: () => false,
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
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

describe('Profil — ouverture automatique de la modale stratégie', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('arrivée sur /profil#notifications sans stratégie : modale fermée, section Notifications ouverte', () => {
    const cmp = mount({ fragment: 'notifications' });

    expect(cmp.showStrategyModal(), 'La modale recouvre la section que la notification vient ouvrir').toBe(false);
    expect(cmp.openNotifications).toBe(true);
    expect(cmp.activeProfileTab()).toBe('params');
  });

  it('arrivée sur /profil?tab=params (« Gérer mes e-mails ») sans stratégie : modale fermée, onglet Paramètres visible', () => {
    const cmp = mount({ fragment: null, query: { tab: 'params' } });

    expect(cmp.showStrategyModal(), 'La modale recouvre l\'onglet que le lien de l\'e-mail vient ouvrir').toBe(false);
    expect(cmp.activeProfileTab()).toBe('params');
  });

  it('tout paramètre ?tab= compte comme lien profond, même une valeur inconnue', () => {
    expect(mount({ fragment: null, query: { tab: 'autre' } }).showStrategyModal()).toBe(false);
  });

  it('un autre paramètre (?checkout=success) ne bloque pas l\'ouverture automatique', () => {
    expect(mount({ fragment: null, query: { checkout: 'success' } }).showStrategyModal()).toBe(true);
  });

  it('arrivée sur /profil nu sans stratégie : la modale s\'ouvre toujours (comportement inchangé)', () => {
    const cmp = mount({ fragment: null });

    expect(cmp.showStrategyModal()).toBe(true);
  });

  it('avec une stratégie renseignée : jamais d\'ouverture automatique', () => {
    expect(mount({ fragment: null, strategy: { tradingStyle: 'SCALPING' } }).showStrategyModal()).toBe(false);
    TestBed.resetTestingModule();
    expect(mount({ fragment: 'notifications', strategy: { tradingStyle: 'SCALPING' } }).showStrategyModal()).toBe(false);
  });

  it('la modale reste disponible par le bouton « Modifier » après une arrivée par #notifications', () => {
    const cmp = mount({ fragment: 'notifications' });

    cmp.openStrategyModal();

    expect(cmp.showStrategyModal()).toBe(true);
  });
});
