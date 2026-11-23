/** Bouclier annonces (#670) : réglage du seuil dans le Profil (résumé et modale stratégie). */
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
  strategy?: { tradingStyle?: string; strategyDescription?: string; newsShieldMinutes?: number | null };
  update?: ReturnType<typeof vi.fn>;
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
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })), updatePreferences: opts.update ?? vi.fn() } },
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

describe('Profil — bouclier annonces (#670)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('résumé : défaut 5 min, coupé à 0, valeur réglée sinon', () => {
    const cmp = mount({ fragment: null, strategy: { tradingStyle: 'SCALP' } });
    expect(cmp.newsShieldLabel(cmp.newsShield())).toBe('5 min avant');
    expect(cmp.newsShieldLabel(0)).toBe('coupé');
    expect(cmp.newsShieldLabel(12)).toBe('12 min avant');
  });

  it('jamais réglé et pas touché : rien envoyé, le serveur garde le défaut', () => {
    const update = vi.fn(() => of({ data: {} }));
    const cmp = mount({ fragment: null, strategy: { tradingStyle: 'SCALP' }, update });
    cmp.openStrategyModal();
    expect(cmp.draftNews()).toBe(5);
    cmp.saveStrategy();
    expect((update.mock.calls[0] as unknown as [Record<string, unknown>])[0]['newsShieldMinutes']).toBeUndefined();
  });

  it('modale : brouillon au réglage enregistré (défaut 5), envoyé avec la stratégie', () => {
    const update = vi.fn(() => of({ data: { newsShieldMinutes: 0 } }));
    const cmp = mount({ fragment: null, strategy: { tradingStyle: 'SCALP', newsShieldMinutes: 12 }, update });
    cmp.openStrategyModal();
    expect(cmp.draftNews()).toBe(12);
    cmp.draftNews.set(0);
    cmp.saveStrategy();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ newsShieldMinutes: 0 }));
    expect(cmp.newsShield()).toBe(0);
  });
});
