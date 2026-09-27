import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { of } from 'rxjs';
import { UserDetailComponent } from './user-detail.component';
import { UserDetailData } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

function makeData(over: Partial<UserDetailData> = {}): UserDetailData {
  return {
    identity: {
      id: 'u1', name: 'Maxime', email: 'maxime@test.com',
      plan: 'PREMIUM', role: 'USER',
      subscriptionStatus: null, ambassadorRefCode: null,
      createdAt: '2026-06-18T00:00:00.000Z', lastActivityAt: '2026-06-19T10:00:00.000Z',
    },
    kpis: {
      daysSinceSignup: 1, lastConnection: '2026-06-19T10:00:00.000Z',
      activeDays: 2, totalDays: 2, sessionTimeMinutes: null,
      ai: { usd: 0.13, tokens: 22000 },
    },
    activeDates: ['2026-06-18', '2026-06-19'],
    aiByFeature: [
      { feature: 'chat', tokens: 15000, costUsd: 0.09 },
      { feature: 'debrief', tokens: 7000, costUsd: 0.04 },
    ],
    profile: {
      market: 'CRYPTO', goal: 'PERFORMANCE', tradingStyle: 'SWING',
      tradingStrategy: ['Price Action', 'ICT'], tradingSessions: ['LONDON', 'NEW_YORK'],
      tradesPerDayMin: null, tradesPerDayMax: null,
      strategyDescription: null, startingCapital: 5000,
    },
    usage: { totalTrades: 1, tradesThisMonth: 1, totalPnl: 0, winRate: 0 },
    topAssets: [{ asset: 'ZEC/USDT', count: 1 }],
    sessions: [],
    ...over,
  };
}

async function render(data: UserDetailData) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of<ParamMap>(convertToParamMap({ id: 'u1' })) },
      },
    ],
  });
  const fixture = TestBed.createComponent(UserDetailComponent);
  fixture.detectChanges();
  const httpMock = TestBed.inject(HttpTestingController);
  httpMock.expectOne(`${environment.apiUrl}/admin/users/u1`).flush({ data });
  // httpResource met à jour sa valeur de façon asynchrone → laisser settle puis re-rendre.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, httpMock, text: fixture.nativeElement.textContent as string, el: fixture.nativeElement as HTMLElement };
}

describe('UserDetailComponent — rendu densifié', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('affiche la carte fusionnée « Compte & engagement » et plus de carte « Informations »', async () => {
    const { text } = await render(makeData());
    expect(text).toContain('Compte & engagement');
    expect(text).toContain('Profil trader');
    expect(text).not.toContain('Informations');
  });

  it('rend le donut conso IA (gradient) quand il y a des appels IA', async () => {
    const { el } = await render(makeData());
    const donut = el.querySelector('.donut') as HTMLElement | null;
    expect(donut).toBeTruthy();
    expect(donut?.style.background).toContain('conic-gradient');
    // légende avec les deux features
    expect((el.textContent ?? '')).toContain('Chat');
    expect((el.textContent ?? '')).toContain('Débrief');
  });

  it('aucun appel IA → message centré, pas de donut', async () => {
    const { el, text } = await render(makeData({ aiByFeature: [], kpis: { ...makeData().kpis, ai: { usd: 0, tokens: 0 } } }));
    expect(el.querySelector('.donut')).toBeNull();
    expect(text).toContain('Aucun appel IA');
  });

  it('sessions vides → ligne « aucune » dans Compte & engagement, pas de table', async () => {
    const { el, text } = await render(makeData({ sessions: [] }));
    expect(el.querySelector('table.tbl')).toBeNull();
    expect(text).toContain('Dernières sessions');
    expect(text).toContain('aucune');
  });

  it('profil trader rendu en grille compacte (pgrid)', async () => {
    const { el } = await render(makeData());
    expect(el.querySelector('.pgrid')).toBeTruthy();
    expect((el.textContent ?? '')).toContain('Crypto');
    expect((el.textContent ?? '')).toContain('Price Action, ICT');
  });
});
