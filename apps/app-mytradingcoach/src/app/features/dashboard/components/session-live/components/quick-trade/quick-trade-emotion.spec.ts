/**
 * #671 : le Trade rapide présélectionnait « Confiant », ce qui faussait l'émotion lue par le moteur de
 * comportement. Plus de défaut : sans choix, le trade part sans émotion (l'API retombe sur l'humeur de la
 * pré-session) ; un second clic retire l'émotion choisie.
 */
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
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

describe('Trade rapide : émotion sans présélection (#671)', () => {
  it('aucun choix : le trade part sans émotion', () => {
    const { cmp, logged } = mount(() => of({ data: null }));
    expect(cmp.qtEmotion()).toBeNull();
    cmp.livePrice.set(100);
    cmp.submitQuickTrade();
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toHaveProperty('emotion');
  });

  it('émotion choisie : envoyée, puis remise à zéro pour le trade suivant', () => {
    const { cmp, logged } = mount(() => of({ data: null }));
    cmp.toggleEmotion('REVENGE');
    cmp.livePrice.set(100);
    cmp.submitQuickTrade();
    expect((logged[0] as { emotion: string }).emotion).toBe('REVENGE');
    expect(cmp.qtEmotion()).toBeNull();
  });

  it('second clic sur l’émotion choisie : retirée', () => {
    const { cmp } = mount(() => of({ data: null }));
    cmp.toggleEmotion('FEAR');
    cmp.toggleEmotion('FEAR');
    expect(cmp.qtEmotion()).toBeNull();
  });
});
