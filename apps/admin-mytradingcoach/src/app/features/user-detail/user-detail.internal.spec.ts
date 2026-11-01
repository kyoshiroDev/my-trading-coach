/** Interrupteur « Compte interne » de la fiche admin (#823). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { of } from 'rxjs';
import { ConfirmService } from '@mtc/front-ui';
import { UserDetailComponent } from './user-detail.component';
import { UserDetailData } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

type Identity = UserDetailData['identity'];
const URL = `${environment.apiUrl}/admin/users/u1`;

function makeData(identity: Partial<Identity> = {}): UserDetailData {
  return {
    identity: {
      id: 'u1', name: 'Alex', email: 'alex@test.com', plan: 'FREE', role: 'USER',
      subscriptionStatus: null, ambassadorRefCode: null, acquisition: { source: null, medium: null, campaign: null },
      trialEndsAt: null, offeredPremium: false, trialSource: null, premiumAccess: false, isDemo: false,
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
  const button = () => el.querySelector('[data-testid="internal-toggle"]') as HTMLButtonElement;
  return { fixture, httpMock, el, button };
}

describe('Fiche admin — compte interne (#823)', () => {
  beforeEach(() => { TestBed.resetTestingModule(); confirm.ask.mockReset(); });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('compte normal : interrupteur éteint, pas de badge', async () => {
    const { el, button } = await render(makeData({ isInternal: false }));
    expect(button().getAttribute('aria-checked')).toBe('false');
    expect(button().disabled).toBe(false);
    expect(el.querySelector('[data-testid="internal-badge"]')).toBeNull();
  });

  it('compte interne : interrupteur allumé, badge « Interne » dans l’en-tête', async () => {
    const { el, button } = await render(makeData({ isInternal: true }));
    expect(button().getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-testid="internal-badge"]')?.textContent?.trim()).toBe('Interne');
  });

  it('clic : PATCH /admin/users/:id { isInternal: true }, toast puis rafraîchissement', async () => {
    const { fixture, httpMock, el, button } = await render(makeData());
    button().click();
    const req = httpMock.expectOne(URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isInternal: true });
    req.flush({ data: {} });
    fixture.detectChanges();
    httpMock.expectOne(URL).flush({ data: makeData({ isInternal: true }) });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Compte marqué interne, hors statistiques');
    expect(button().getAttribute('aria-checked')).toBe('true');
  });

  it('démarquer : PATCH { isInternal: false }', async () => {
    const { httpMock, button } = await render(makeData({ isInternal: true }));
    button().click();
    const req = httpMock.expectOne(URL);
    expect(req.request.body).toEqual({ isInternal: false });
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
  });

  it('compte ADMIN : interrupteur désactivé, avec la raison, aucun appel', async () => {
    const { httpMock, button } = await render(makeData({ role: 'ADMIN' }));
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('title')).toBe('Compte admin, déjà hors statistiques');
    button().click();
    httpMock.expectNone(URL);
  });
});
