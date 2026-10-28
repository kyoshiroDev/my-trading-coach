import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { UserDetailComponent, offerBlockReason, offerWarning } from './user-detail.component';
import { UserDetailData } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

type Identity = UserDetailData['identity'];
const URL = `${environment.apiUrl}/admin/users/u1`;

function makeData(identity: Partial<Identity> = {}): UserDetailData {
  return {
    identity: {
      id: 'u1', name: 'Alex', email: 'alex@test.com', plan: 'FREE', role: 'USER',
      subscriptionStatus: null, ambassadorRefCode: null, acquisition: { source: null, medium: null, campaign: null },
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
    topAssets: [], offer: { founder: null, partner: null }, sessions: [],
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
      message: expect.stringMatching(/Offrir 30 jours de Premium à alex@test\.com \? Fin le \d{2}\/\d{2}\/\d{4}\. Aucun prélèvement\./),
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

const founder = (over: object = {}) => ({
  number: 7, status: 'ACTIVE' as const, interval: 'month' as const, takenAt: '2026-11-02T10:00:00.000Z',
  endedAt: null, cta: null, reserved: true, firstChargeAt: '2026-11-16T10:00:00.000Z', ...over,
});
const reservedData = (over: object = {}) => ({
  ...makeData({ plan: 'PREMIUM', subscriptionStatus: 'trialing' }),
  offer: { founder: founder(over), partner: null },
});

describe('Fiche admin — réservation fondateur en cours (#769)', () => {
  beforeEach(() => { TestBed.resetTestingModule(); confirm.ask.mockReset(); });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('bouton désactivé et avertissement visible avec la date du premier prélèvement', async () => {
    const { el, button } = await render(reservedData());
    expect(button().disabled).toBe(true);
    expect(el.querySelector('[data-testid="offer-warning"]')?.textContent?.replace(/\u00a0/g, ' ').trim()).toBe(
      'Réservation fondateur en cours : premier prélèvement le 16/11/2026. Offrir du Premium ne décalerait pas ce prélèvement.',
    );
  });

  it('offre possible : aucun avertissement', async () => {
    const { el } = await render(makeData());
    expect(el.querySelector('[data-testid="offer-warning"]')).toBeNull();
  });
});

describe('offerWarning (#769)', () => {
  it('date inconnue : même avertissement, sans date', () => {
    expect(offerWarning(reservedData({ firstChargeAt: null }) as UserDetailData)).toBe(
      'Réservation fondateur en cours. Offrir du Premium ne décalerait pas le premier prélèvement.',
    );
  });

  it('place déjà payée : raison habituelle, pas de mention de réservation', () => {
    expect(offerWarning(reservedData({ reserved: false, firstChargeAt: null }) as UserDetailData)).toBe('Abonnement Stripe en cours');
  });
});

describe('offerBlockReason', () => {
  it('paiement Stripe en attente (past_due, unpaid) : offre refusée avec le message', () => {
    for (const status of ['past_due', 'unpaid']) {
      expect(offerBlockReason(makeData({ subscriptionStatus: status }).identity)?.replace(/\u00a0/g, ' ')).toBe(
        'Paiement Stripe en attente : régler d’abord l’abonnement',
      );
    }
  });

  it('null pour un FREE standard, même avec un ancien abonnement résilié', () => {
    expect(offerBlockReason(makeData().identity)).toBeNull();
    expect(offerBlockReason(makeData({ subscriptionStatus: 'canceled' }).identity)).toBeNull();
  });
});
