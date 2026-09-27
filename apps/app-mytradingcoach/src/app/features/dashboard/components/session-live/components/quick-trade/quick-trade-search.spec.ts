/**
 * APP-03 — recherche d'instrument du trade rapide : « aucun résultat » et « recherche
 * indisponible » ne doivent pas se confondre (avant : une panne ressemblait à « aucun résultat »).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { QuickTradeComponent } from './quick-trade.component';
import { SetupsStore } from '@app/core/stores/setups.store';
import { TradesApi } from '@app/core/api/trades.api';

function mount(searchInstruments: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      {
        provide: TradesApi,
        useValue: {
          getUserAssets: vi.fn(() => of({ data: [] })),
          getLivePrice: vi.fn(() => of({ data: null })),
          saveUserAssets: vi.fn(() => of({ data: null })),
          searchInstruments,
          setFavoriteAsset: vi.fn(() => of({ data: null })),
        },
      },
    ],
  });
  TestBed.overrideComponent(QuickTradeComponent, {
    set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(QuickTradeComponent);
  fixture.detectChanges();
  return fixture.componentInstance as any;
}

const type = (cmp: any, q: string) => {
  cmp.onCustomAssetSearch({ target: { value: q } } as unknown as Event);
  vi.advanceTimersByTime(350);
};

describe('QuickTradeComponent — issue de la recherche d’instrument', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('résultats trouvés → found', () => {
    const cmp = mount(vi.fn(() => of({ data: [{ symbol: 'NQ', label: 'Nasdaq', category: 'FUTURES' }] })));
    type(cmp, 'NQ');
    expect(cmp.customAssetSearchStatus()).toBe('found');
    expect(cmp.customAssetResults().length).toBe(1);
  });

  it('aucun résultat → none', () => {
    const cmp = mount(vi.fn(() => of({ data: [] })));
    type(cmp, 'ZZZ');
    expect(cmp.customAssetSearchStatus()).toBe('none');
  });

  it('API en erreur → unavailable (et pas « aucun résultat »)', () => {
    const cmp = mount(vi.fn(() => throwError(() => new Error('503'))));
    type(cmp, 'NQ');
    expect(cmp.customAssetSearchStatus()).toBe('unavailable');
    expect(cmp.customAssetResults()).toEqual([]);
  });

  it('moins de 2 caractères → pas de statut', () => {
    const cmp = mount(vi.fn(() => of({ data: [] })));
    type(cmp, 'N');
    expect(cmp.customAssetSearchStatus()).toBeNull();
  });
});
