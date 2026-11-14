/**
 * Audit fonctionnel #994 (lot 1c, F6) : le journal affichait « Aucun trade enregistré · Ajouter mon
 * premier trade » aussi quand le chargement échouait (TradesStore.error lu nulle part) et quand un
 * filtre ne trouvait rien sur un compte qui a des centaines de trades.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { JournalComponent } from './journal.component';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { UserStore } from '../../core/stores/user.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradesApi } from '../../core/api/trades.api';
import { ToastService } from '../../core/services/toast.service';
import { environment } from '@app/environments/environment';
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';

const JOUR = '2026-07-10T16:41:00.000Z';

function trade(id: string): Trade {
  return {
    id, asset: 'MNQ', side: 'SHORT', entry: 29884, exit: 29851.5, pnl: 62.92,
    quantity: 1, tradedAt: JOUR, setupId: null, emotion: null, commission: null,
  } as unknown as Trade;
}

/**
 * Store minimal mais VIVANT : `removeTrade` retire réellement du signal, sans quoi
 * les groupes ne se recalculeraient pas et le test ne pourrait rien dire de la
 * péremption — le défaut central de ce correctif.
 */
function storeVivant(trades: Trade[]) {
  const liste = signal<Trade[]>(trades);
  return {
    trades: liste,
    totalTrades: signal(trades.length),
    loaded: signal(true), isLoading: signal(false), isLoadingMore: signal(false),
    hasNextPage: signal(false), stats: signal(null), isLoadingStats: signal(false), error: signal<string | null>(null),
    loadTrades: vi.fn(), loadMore: vi.fn(), loadStats: vi.fn(), reset: vi.fn(),
    updateTrade: vi.fn(), addTrade: vi.fn(),
    removeTrade: vi.fn((id: string) => liste.set(liste().filter((t) => t.id !== id))),
  };
}

function mount(trades: Trade[], reassignImpl: () => unknown = () => of({ data: { moved: 0 } })) {
  const store = storeVivant(trades);
  const tradesApi = {
    getStats: () => of({ data: null }),
    reassign: vi.fn(reassignImpl),
    // Le journal supprime via TradesApi (étape 4 de l'audit) : le mock émet la VRAIE requête
    // DELETE, pour que HttpTestingController continue de simuler 404 / refus / échecs partiels.
    delete: (id: string) => TestBed.inject(HttpClient).delete<void>(`${environment.apiUrl}/trades/${id}`),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: TradesStore, useValue: store },
      {
        provide: UserStore,
        useValue: {
          isPremium: () => false, isDemo: () => false, user: () => ({}),
          startingCapital: () => 10000, displayName: () => 'Test',
        },
      },
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: SelectedAccountStore,
        useValue: {
          ...statsScopeStub(),
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, selectedAccountId: signal('all'),
          load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
      { provide: TradesApi, useValue: tradesApi },
    ],
  });
  TestBed.overrideComponent(JournalComponent, {
    set: {
      template: '<div></div>', imports: [], styleUrls: [],
      styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { c: fixture.componentInstance as any, http, store, fixture, tradesApi };
}

beforeEach(() => TestBed.resetTestingModule());

describe('Journal — état vide juste', () => {
  it('aucun trade, aucun filtre, pas d’erreur → vrai journal vide', () => {
    const { c } = mount([]);
    expect(c.emptyKind()).toBe('none');
  });

  it('échec du chargement → état d’erreur avec « Réessayer », jamais « premier trade »', () => {
    const { c, store } = mount([]);
    store.error.set('Http failure');
    expect(c.emptyKind()).toBe('error');
  });

  it('filtre sans résultat → « aucun trade pour ces filtres »', () => {
    const { c } = mount([]);
    c.filterSide.set('SHORT');
    expect(c.emptyKind()).toBe('filtered');
  });

  it('période sans résultat (« Auj. ») → « aucun trade pour ces filtres »', () => {
    const { c } = mount([]);
    c.setDatePreset('today');
    expect(c.emptyKind()).toBe('filtered');
  });

  it('des trades affichés → pas d’état vide', () => {
    const { c } = mount([trade('a')]);
    expect(c.emptyKind()).toBeNull();
  });

  it('« Tout afficher » remet filtres et période à zéro', () => {
    const { c } = mount([]);
    c.filterSide.set('SHORT');
    c.setDatePreset('today');
    c.showAllTrades();
    expect(c.emptyKind()).toBe('none');
  });
});
