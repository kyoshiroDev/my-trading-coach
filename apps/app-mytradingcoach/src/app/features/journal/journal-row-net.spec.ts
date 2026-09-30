/**
 * Journal — le montant d'une ligne de trade est le P&L NET.
 *
 * `Trade.pnl` est stocké BRUT (convention PROMPT-213). La ligne affichait `trade.pnl` tel
 * quel, alors que l'en-tête de colonne promet un « résultat net, commissions et frais
 * déduits » et que les totaux jour/semaine juste au-dessus sont nets : sur un jour avec
 * frais, la somme des lignes ne tombait pas sur le total affiché, et un trade à +1 $ brut
 * pour 1,90 $ de frais paraissait gagnant.
 *
 * Le test rend le VRAI template (pas un template de remplacement) pour vérifier ce que
 * l'utilisateur lit.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { PnlColorPipe, PnlFormatPipe, MoneyPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { JournalComponent } from './journal.component';
import { TradesStore } from '../../core/stores/trades.store';
import { UserStore } from '../../core/stores/user.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { TradesApi, Trade } from '../../core/api/trades.api';

// Le template rendu est le VRAI fichier du journal, lu sur disque.
const JOURNAL_HTML = readFileSync(join(__dirname, 'journal.component.html'), 'utf8');

const trade = (over: Partial<Trade>): Trade => ({
  id: 't1', userId: 'u1', asset: 'MNQ', side: 'LONG', entry: 18600, exit: 18605,
  stopLoss: null, takeProfit: null, pnl: 10, commission: 2, riskReward: null, quantity: 1,
  capitalEngaged: null, emotion: null, setupId: 's1', setup: { id: 's1', title: 'Breakout', color: '#fff' },
  accountId: null, session: 'NEW_YORK', timeframe: 'M5', notes: null, tags: [],
  tradedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  ...over,
});

async function render(trades: Trade[]): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: TradesStore,
        useValue: {
          trades: signal(trades), totalTrades: signal(trades.length), loaded: signal(true),
          isLoading: signal(false), isLoadingMore: signal(false), hasNextPage: signal(false),
          stats: signal(null), isLoadingStats: signal(false),
          loadTrades: vi.fn(), loadMore: vi.fn(), loadStats: vi.fn(),
          reset: vi.fn(), removeTrade: vi.fn(), updateTrade: vi.fn(), addTrade: vi.fn(),
        },
      },
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
          accounts: signal([]), activeAccounts: signal([]), accountParam: () => undefined,
          selected: () => null, selectedAccountId: signal('all'), displayCurrency: signal('USD'),
          currencyOf: () => 'USD', load: vi.fn(), loaded: signal(true), isLoading: signal(false),
        },
      },
      { provide: TradesApi, useValue: { getStats: () => of({ data: null }), getInstruments: () => of([]) } },
    ],
  });
  // Vrai template, mais sans les composants enfants (topbar, formulaire, import…) : seuls les pipes
  // qui produisent le texte des lignes sont gardés.
  TestBed.overrideComponent(JournalComponent, {
    set: {
      template: JOURNAL_HTML, styleUrls: [], styleUrl: undefined as unknown as string,
      imports: [DatePipe, DecimalPipe, TitleCasePipe, PnlColorPipe, PnlFormatPipe, MoneyPipe, EmotionEmojiPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const rowPnl = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-testid="trade-pnl"]')].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

describe('Journal — montant de la ligne = P&L net', () => {
  it('frais déduits : +10 $ brut, 2 $ de frais → +$8.00', async () => {
    expect(rowPnl(await render([trade({ pnl: 10, commission: 2 })]))[0]).toMatch(/^\+\$8\.00/);
  });

  it('gain brut mangé par les frais : affiché en perte', async () => {
    expect(rowPnl(await render([trade({ pnl: 1, commission: 1.9 })]))[0]).toMatch(/^-\$0\.90/);
  });

  it('sans frais : net = brut', async () => {
    expect(rowPnl(await render([trade({ pnl: 10, commission: null })]))[0]).toMatch(/^\+\$10\.00/);
  });
});
