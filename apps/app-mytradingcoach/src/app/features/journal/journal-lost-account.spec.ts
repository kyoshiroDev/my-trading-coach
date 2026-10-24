/**
 * Journal — compte perdu : la liste garde tous les trades, avec un badge « Échoué » ou « Archivé »
 * sur ceux d'un compte hors statistiques ; les chiffres du haut suivent l'interrupteur des
 * statistiques (`includeInactive`), sans recharger la liste.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';
import JOURNAL_HTML from './journal.component.html?raw';

/**
 * Heures FIXES et distinctes (une heure d'écart, même journée quel que soit le fuseau entre UTC-8 et
 * UTC+12) : le journal trie la journée du plus récent au plus ancien, l'ordre des lignes est donc
 * déterministe. Avec `new Date()`, deux trades tombaient ou non sur la même milliseconde et l'ordre
 * des badges changeait d'une exécution à l'autre.
 */
const AT = {
  t1: '2026-10-14T11:00:00.000Z',
  t2: '2026-10-14T10:00:00.000Z',
  t3: '2026-10-14T09:00:00.000Z',
  t4: '2026-10-14T08:00:00.000Z',
} as const;

const trade = (id: keyof typeof AT, account: Trade['account']): Trade => ({
  id, userId: 'u1', asset: 'MNQ', side: 'LONG', entry: 18600, exit: 18605,
  stopLoss: null, takeProfit: null, pnl: 10, commission: 0, riskReward: null, quantity: 1,
  capitalEngaged: null, emotion: null, setupId: 's1', setup: { id: 's1', title: 'Breakout', color: '#fff' },
  accountId: account?.id ?? null, account, session: 'NEW_YORK', timeframe: 'M5', notes: null, tags: [],
  tradedAt: AT[id], createdAt: AT[id],
} as Trade);

async function render(trades: Trade[]) {
  const tradesStore = {
    trades: signal(trades), totalTrades: signal(trades.length), loaded: signal(true),
    isLoading: signal(false), isLoadingMore: signal(false), hasNextPage: signal(false),
    stats: signal(null), isLoadingStats: signal(false),
    loadTrades: vi.fn(), loadMore: vi.fn(), loadStats: vi.fn(),
    reset: vi.fn(), removeTrade: vi.fn(), updateTrade: vi.fn(), addTrade: vi.fn(),
  };
  const accountStore = {
    ...statsScopeStub(),
    accounts: signal([{ status: 'ACTIVE' }, { status: 'FAILED' }]),
    activeAccounts: signal([]), accountParam: () => undefined,
    selected: () => null, selectedAccountId: signal('all'), displayCurrency: signal('USD'),
    currencyOf: () => 'USD', load: vi.fn(), loaded: signal(true), isLoading: signal(false),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: TradesStore, useValue: tradesStore },
      {
        provide: UserStore,
        useValue: { isPremium: () => false, isDemo: () => false, user: () => ({}), startingCapital: () => 10000, displayName: () => 'Test' },
      },
      { provide: SetupsStore, useValue: { active: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: SelectedAccountStore, useValue: accountStore },
      { provide: TradesApi, useValue: { getStats: () => of({ data: null }), getInstruments: () => of([]) } },
    ],
  });
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
  return { fixture, el: fixture.nativeElement as HTMLElement, tradesStore, accountStore };
}

describe('Journal — compte perdu', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('la liste garde tous les trades ; badge sur ceux d\'un compte échoué ou archivé', async () => {
    const { el } = await render([
      trade('t1', { id: 'a', label: 'Apex 50K #2', status: 'ACTIVE' }),
      trade('t2', { id: 'f', label: 'Apex 50K #1', status: 'FAILED' }),
      trade('t3', { id: 'x', label: 'Lucid 25K', status: 'ARCHIVED' }),
      trade('t4', null),
    ]);
    expect(el.querySelectorAll('[data-testid="trade-row"]').length).toBe(4);
    const badges = [...el.querySelectorAll('[data-testid="trade-account-badge"]')];
    expect(badges.map((b) => b.textContent!.trim())).toEqual(['Échoué', 'Archivé']);
    expect(badges[0].getAttribute('title')).toBe('Apex 50K #1 : hors statistiques');
  });

  it('KPIs : sans includeInactive par défaut, avec après l\'interrupteur, sans recharger la liste', async () => {
    const { fixture, tradesStore, accountStore } = await render([trade('t1', null)]);
    const lastStats = () => tradesStore.loadStats.mock.calls.at(-1)![0] as Record<string, string>;
    expect(lastStats()['includeInactive']).toBeUndefined();
    const listLoads = tradesStore.loadTrades.mock.calls.length;

    accountStore.includeInactive.set(true);
    fixture.detectChanges();
    expect(lastStats()['includeInactive']).toBe('true');
    expect(tradesStore.loadTrades.mock.calls.length).toBe(listLoads);
    expect(tradesStore.loadTrades.mock.calls.every((c) => !('includeInactive' in (c[0] ?? {})))).toBe(true);
  });

  it('compte marqué échoué entre-temps : les KPIs se rechargent', async () => {
    const { fixture, tradesStore, accountStore } = await render([trade('t1', null)]);
    const before = tradesStore.loadStats.mock.calls.length;
    accountStore.accounts.set([{ status: 'FAILED' }, { status: 'FAILED' }]);
    fixture.detectChanges();
    expect(tradesStore.loadStats.mock.calls.length).toBe(before + 1);
  });

  it('compteur des filtres : « dans les chiffres » quand des comptes sont exclus', async () => {
    const { fixture, el, tradesStore, accountStore } = await render([trade('t1', null)]);
    (tradesStore.stats as unknown as { set: (v: unknown) => void }).set({ totalTrades: 8, winRate: 75, totalPnl: 1, excludedAccounts: { failed: 1, archived: 0 } });
    fixture.detectChanges();
    const count = () => el.querySelector('[data-testid="journal-filter-count"]')!.textContent!.trim();
    expect(count()).toBe('8 trades dans les chiffres');
    accountStore.includeInactive.set(true);
    fixture.detectChanges();
    expect(count()).toBe('8 trades');
  });
});

