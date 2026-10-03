import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { UserDetailComponent, offerBlockReason } from './user-detail.component';
import { UserDetailData } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

type Identity = UserDetailData['identity'];
const URL = `${environment.apiUrl}/admin/users/u1`;

function makeData(identity: Partial<Identity> = {}): UserDetailData {
  return {
    identity: {
      id: 'u1', name: 'Louis', email: 'louis@test.com', plan: 'FREE', role: 'USER',
      subscriptionStatus: null, ambassadorRefCode: null,
      trialEndsAt: null, offeredPremium: false, isDemo: false,
      createdAt: '2026-09-01T00:00:00.000Z', lastActivityAt: null,
      ...identity,
    },
    kpis: { daysSinceSignup: 1, lastConnection: null, activeDays: 0, totalDays: 2, sessionTimeMinutes: null, ai: { usd: 0, tokens: 0 } },
    activeDates: [], aiByFeature: [],
    profile: {
      market: null, goal: null, tradingStyle: null, tradingStrategy: [], tradingSessions: [],
      tradesPerDayMin: null, tradesPerDayMax: null, strategyDescription: null, startingCapital: 0,
    },
    usage: { totalTrades: 0, tradesThisMonth: 0, totalPnl: 0, winRate: 0 },
    topAssets: [], sessions: [],
  };
}

const confirm = { ask: vi.fn() };

async function render(data: UserDetailData) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: ConfirmService, useValue: confirm },
      { provide: ActivatedRoute, useValue: { paramMap: of<ParamMap>(convertToParamMap({ id: 'u1' })) } },
    ],
  });
  const fixture = TestBed.createComponent(UserDetailComponent);
  fixture.detectChanges();
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne(URL).flush({ data });
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = () => el.querySelector('[data-testid="offer-premium"]') as HTMLButtonElement;
  return { fixture, httpMock, el, button };
}

describe('Fiche admin — Premium offert', () => {
  beforeEach(() => { TestBed.resetTestingModule(); confirm.ask.mockReset(); });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('FREE sans offre : bouton « Offrir 1 mois de Premium » actif, plan « gratuit »', async () => {
    const { el, button } = await render(makeData());
    expect(button().textContent).toContain('Offrir 1 mois de Premium');
    expect(button().disabled).toBe(false);
    expect(el.textContent).toContain('FREE · gratuit');
  });

  it('offre en cours : « Premium offert jusqu’au », bouton « Prolonger », plan « offert »', async () => {
    const { el, button } = await render(makeData({ trialEndsAt: '2026-11-02T12:00:00.000Z', offeredPremium: true }));
    expect(el.textContent).toContain("Premium offert jusqu'au");
    expect(el.textContent).toContain('02/11/2026');
    expect(el.textContent).toContain('FREE · offert');
    expect(button().textContent).toContain('Prolonger d’1 mois');
  });

  it.each([
    ['abonnement Stripe', { subscriptionStatus: 'active' }],
    ['essai Stripe', { subscriptionStatus: 'trialing' }],
    ['plan PREMIUM', { plan: 'PREMIUM' as const }],
    ['ADMIN', { role: 'ADMIN' as const }],
    ['BETA_TESTER', { role: 'BETA_TESTER' as const }],
    ['démo', { isDemo: true }],
  ])('bouton désactivé avec info-bulle : %s', async (_l, patch) => {
    const { button } = await render(makeData(patch));
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('title')).toBeTruthy();
  });

  it('confirmation dans la page, puis POST, toast et rafraîchissement', async () => {
    confirm.ask.mockResolvedValue(true);
    const { fixture, httpMock, el, button } = await render(makeData());
    button().click();
    await fixture.whenStable();
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/Offrir 30 jours de Premium à louis@test\.com \? Fin le \d{2}\/\d{2}\/\d{4}\. Aucun prélèvement\./),
    }));
    const req = httpMock.expectOne(`${URL}/offer-premium`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { trialEndsAt: '2026-11-02T12:00:00.000Z' } });
    fixture.detectChanges();
    httpMock.expectOne(URL).flush({ data: makeData({ trialEndsAt: '2026-11-02T12:00:00.000Z', offeredPremium: true }) });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Premium offert jusqu’au 02/11/2026');
  });

  it('annuler la confirmation : aucun appel', async () => {
    confirm.ask.mockResolvedValue(false);
    const { fixture, httpMock, button } = await render(makeData());
    button().click();
    await fixture.whenStable();
    httpMock.expectNone(`${URL}/offer-premium`);
  });
});

describe('offerBlockReason', () => {
  it('null pour un FREE standard, même avec un ancien abonnement résilié', () => {
    expect(offerBlockReason(makeData().identity)).toBeNull();
    expect(offerBlockReason(makeData({ subscriptionStatus: 'canceled' }).identity)).toBeNull();
  });
});
