/**
 * Audit fonctionnel #994 (lot 1c, F3) : sans prix live (actif inconnu du flux, flux en panne), le
 * trade rapide partait avec `entry: 0` — l'API accepte entry ≥ 0 — et un P&L absurde à la clôture.
 */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { QuickTradeComponent } from './quick-trade.component';
import { SetupsStore } from '@app/core/stores/setups.store';
import { TradesApi } from '@app/core/api/trades.api';
import { ToastService } from '@app/core/services/toast.service';

function mount(livePrice: () => unknown) {
  const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ToastService, useValue: toast },
      {
        provide: SetupsStore,
        useValue: { active: signal([{ id: 's1', title: 'Breakout', color: '#fff', archived: false, sortOrder: 0 }]), load: vi.fn(), loaded: signal(true) },
      },
      {
        provide: TradesApi,
        useValue: {
          getUserAssets: vi.fn(() => of({ data: [] })),
          getLivePrice: vi.fn(livePrice),
          saveUserAssets: vi.fn(() => of({ data: null })),
          searchInstruments: vi.fn(() => of({ data: [] })),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cmp = fixture.componentInstance as any;
  const logged: unknown[] = [];
  fixture.componentInstance.tradeLogged.subscribe((t) => logged.push(t));
  cmp.qtSelectedAsset.set({ symbol: 'XYZ', label: 'XYZ', isFavorite: false });
  return { cmp, logged, toast };
}

describe('Trade rapide sans prix live', () => {
  it('flux sans prix et aucun prix affiché : rien n’est loggé, message clair', () => {
    const { cmp, logged, toast } = mount(() => of({ data: null }));
    cmp.livePrice.set(null);
    cmp.submitQuickTrade();
    expect(logged).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it('flux en erreur et aucun prix affiché : rien n’est loggé', () => {
    const { cmp, logged } = mount(() => throwError(() => new Error('down')));
    cmp.livePrice.set(null);
    cmp.submitQuickTrade();
    expect(logged).toHaveLength(0);
  });

  it('flux en erreur mais dernier prix affiché : loggé à ce prix', () => {
    const { cmp, logged } = mount(() => throwError(() => new Error('down')));
    cmp.livePrice.set(101.5);
    cmp.submitQuickTrade();
    expect(logged).toHaveLength(1);
    expect((logged[0] as { entry: number }).entry).toBe(101.5);
  });
});
