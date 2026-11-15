/**
 * Audit fonctionnel #994 (lot 1d #998) — historique des séances.
 * F21 : semaines triées par numéro ISO sans l'année : en janvier, la « Semaine 53 » (1er au 3) passait
 *       avant les semaines 1 à 5 ; en décembre, les 29-31 devenaient « Semaine 1 » et passaient en bas.
 * Limite : 50 séances par mois demandées ; un trader multi-comptes en perdait (l'API plafonne à 200).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SessionsComponent } from './sessions.component';
import { SessionApi } from '../../core/api/session.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { UserStore } from '../../core/stores/user.store';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';

function setup(startedAts: string[]) {
  const sessions = startedAts.map((startedAt, i) => ({ id: `s${i}`, startedAt, endedAt: null, totalPnl: 1, totalTrades: 1 }));
  const api = { getSessionsByMonth: vi.fn(() => of({ data: sessions })) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SessionApi, useValue: api },
      {
        provide: SelectedAccountStore,
        useValue: { ...statsScopeStub(), accounts: signal([]), accountParam: () => undefined, loaded: signal(true), isLoading: signal(false), load: vi.fn() },
      },
      { provide: UserStore, useValue: { isPremium: () => true, isDemo: () => false, user: () => ({}) } },
    ],
  });
  TestBed.overrideComponent(SessionsComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(SessionsComponent);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { cmp: fixture.componentInstance as any, api };
}

beforeEach(() => TestBed.resetTestingModule());

describe('Historique des séances — semaines', () => {
  it('janvier : la semaine du 1er janvier (n° 53 de l’année d’avant) est en BAS, la plus récente en haut', () => {
    // 2027-01-01 = vendredi (semaine ISO 53 de 2026) ; 2027-01-11 = lundi (semaine 2).
    const { cmp } = setup(['2027-01-01T14:00:00', '2027-01-11T14:00:00', '2027-01-05T14:00:00']);
    const firstSessions = cmp.weekGroups().map((g: { sessions: { startedAt: string }[] }) => g.sessions[0].startedAt.slice(0, 10));
    expect(firstSessions).toEqual(['2027-01-11', '2027-01-05', '2027-01-01']);
  });

  it('décembre : les 29-31 (semaine 1 de l’année suivante) sont en HAUT', () => {
    // 2025-12-29 = lundi de la semaine ISO 1 de 2026.
    const { cmp } = setup(['2025-12-02T14:00:00', '2025-12-29T14:00:00', '2025-12-15T14:00:00']);
    const firstSessions = cmp.weekGroups().map((g: { sessions: { startedAt: string }[] }) => g.sessions[0].startedAt.slice(0, 10));
    expect(firstSessions).toEqual(['2025-12-29', '2025-12-15', '2025-12-02']);
  });

  it('un mois chargé n’est pas tronqué à 50 séances', () => {
    const { api } = setup([]);
    expect((api.getSessionsByMonth.mock.calls[0] as unknown[])[3]).toBe(200);
  });
});
