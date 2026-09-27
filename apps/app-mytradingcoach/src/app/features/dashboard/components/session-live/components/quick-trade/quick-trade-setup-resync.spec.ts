/**
 * dernier vestige du pattern « état figé non revalidé » (bug Val).
 *
 * Le compagnon de session vit des heures. `qtSetup` était fixé une seule fois au
 * premier setup actif, avec le garde `!this.qtSetup()` : un setup supprimé ou
 * archivé entre-temps laissait un id fantôme, et chaque trade rapide loggé partait
 * en 400. Même défaut que l'import CSV corrigé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { QuickTradeComponent } from './quick-trade.component';
import { SetupsStore } from '../../../../../../core/stores/setups.store';
import { TradesApi } from '../../../../../../core/api/trades.api';

interface TestSetup {
  id: string;
  title: string;
  color: string;
  description: string;
  archived: boolean;
  sortOrder: number;
}

const mk = (title: string, sortOrder: number): TestSetup => ({
  id: `s${sortOrder}`, title, color: '#10b981', description: '', archived: false, sortOrder,
});

const BREAKOUT = mk('Breakout', 0);
const PULLBACK = mk('Pullback', 1);
const RANGE = mk('Range', 2);

function mount(initial: TestSetup[]) {
  const active = signal<TestSetup[]>(initial);

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SetupsStore, useValue: { active, load: vi.fn(), loaded: signal(true) } },
      {
        provide: TradesApi,
        useValue: {
          getUserAssets: vi.fn(() => of({ data: [] })),
          getLivePrice: vi.fn(() => of({ data: null })),
          saveUserAssets: vi.fn(() => of({ data: null })),
          searchInstruments: vi.fn(() => of({ data: [] })),
          setFavoriteAsset: vi.fn(() => of({ data: null })),
        },
      },
    ],
  });
  TestBed.overrideComponent(QuickTradeComponent, {
    set: {
      template: '<div></div>',
      imports: [],
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      schemas: [NO_ERRORS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(QuickTradeComponent);
  fixture.detectChanges();

  return { fixture, active, cmp: fixture.componentInstance as any };
}

describe('QuickTradeComponent — resync du setup du trade rapide', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('sélectionne le premier setup actif au montage', () => {
    const { cmp } = mount([BREAKOUT, PULLBACK, RANGE]);
    expect(cmp.qtSetup()).toBe(BREAKOUT.id);
  });

  it('setup courant retiré de la liste → recale sur un setup valide', () => {
    const { fixture, active, cmp } = mount([BREAKOUT, PULLBACK, RANGE]);
    expect(cmp.qtSetup()).toBe(BREAKOUT.id);

    active.set([PULLBACK, RANGE]);
    fixture.detectChanges();

    expect(
      cmp.qtSetup(),
      'id fantôme conservé : chaque trade rapide partirait en 400',
    ).toBe(PULLBACK.id);
  });

  it('choix utilisateur encore valide → jamais écrasé', () => {
    const { fixture, active, cmp } = mount([BREAKOUT, PULLBACK, RANGE]);

    cmp.qtSetup.set(RANGE.id);
    active.set([BREAKOUT, RANGE]);
    fixture.detectChanges();

    expect(cmp.qtSetup()).toBe(RANGE.id);
  });

  it('plus aucun setup actif → sélection vide', () => {
    const { fixture, active, cmp } = mount([BREAKOUT]);

    active.set([]);
    fixture.detectChanges();

    expect(cmp.qtSetup()).toBe('');
  });

  it('liste chargée après le montage → sélection posée', () => {
    const { fixture, active, cmp } = mount([]);
    expect(cmp.qtSetup()).toBe('');

    active.set([BREAKOUT, PULLBACK]);
    fixture.detectChanges();

    expect(cmp.qtSetup()).toBe(BREAKOUT.id);
  });
});
