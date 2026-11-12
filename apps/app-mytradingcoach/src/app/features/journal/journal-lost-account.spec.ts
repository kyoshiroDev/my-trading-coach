/**
 * Journal — compte perdu : la liste, les en-têtes de jour / semaine et la barre de chiffres lisent
 * le MÊME jeu de trades. Comptes échoués et archivés exclus par défaut (l'API filtre la liste ET
 * les chiffres) ; l'interrupteur (`includeInactive`) les réinclut partout, badge à l'appui.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PctPipe } from '@mtc/front-ui';
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
      imports: [DatePipe, DecimalPipe, TitleCasePipe, PnlColorPipe, PnlFormatPipe, MoneyPipe, EmotionEmojiPipe, PctPipe],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(JournalComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, tradesStore, accountStore };
}

/**
 * Cas réel (09/11) : 1 compte actif, 3 trades le vendredi 6/11 (−88,50) ; 3 comptes archivés
 * (6/11 : −300 et −232,56 ; 4/11 : +16 158,86). Tout compris : 6/11 = 5 trades −621,06, semaine
 * +15 537,80, les chiffres de la capture.
 */
const NOV = (day: number, h: number) => `2026-11-0${day}T${String(h).padStart(2, '0')}:00:00.000Z`;
const at = (id: string, h: number, pnl: number, account: Trade['account'], day = 6): Trade => ({
  ...trade('t1', account), id, pnl, tradedAt: NOV(day, h), createdAt: NOV(day, h),
} as Trade);
const ACTIVE = { id: 'a', label: 'Apex 50K #2', status: 'ACTIVE' } as const;
const ARCHIVED = [
  { id: 'x1', label: 'Lucid 25K', status: 'ARCHIVED' },
  { id: 'x2', label: 'Topstep 50K', status: 'ARCHIVED' },
  { id: 'x3', label: 'Apex 50K #1', status: 'ARCHIVED' },
] as const;
const ACTIVE_TRADES = [at('a1', 16, 447, ACTIVE), at('a2', 15, -267.5, ACTIVE), at('a3', 14, -268, ACTIVE)];
const ARCHIVED_TRADES = [at('x1', 13, -300, ARCHIVED[0]), at('x2', 12, -232.56, ARCHIVED[1]), at('x3', 14, 16_158.86, ARCHIVED[2], 4)];

type Groups = {
  tradesByDay: () => { count: number; totalPnlNet: number; partial: boolean }[];
  tradesByWeek: () => { count: number; totalPnlNet: number; partial: boolean }[];
};

describe('Journal — compte perdu', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('badge « Échoué » / « Archivé » sur les trades d\'un compte perdu renvoyés par l\'API (interrupteur allumé)', async () => {
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

  it('liste et chiffres : MÊMES filtres, sans includeInactive par défaut, avec après l\'interrupteur (les deux rechargés)', async () => {
    const { fixture, tradesStore, accountStore } = await render([trade('t1', null)]);
    const lastList = () => tradesStore.loadTrades.mock.calls.at(-1)![0] as Record<string, string>;
    const lastStats = () => tradesStore.loadStats.mock.calls.at(-1)![0] as Record<string, string>;
    expect(lastList()['includeInactive']).toBeUndefined();
    expect(lastStats()).toEqual(lastList());

    accountStore.includeInactive.set(true);
    fixture.detectChanges();
    expect(lastList()['includeInactive']).toBe('true');
    expect(lastStats()).toEqual(lastList());

    accountStore.includeInactive.set(false);
    fixture.detectChanges();
    expect(lastList()['includeInactive']).toBeUndefined();
    expect(lastStats()).toEqual(lastList());
  });

  it('compte marqué échoué entre-temps : liste ET chiffres se rechargent', async () => {
    const { fixture, tradesStore, accountStore } = await render([trade('t1', null)]);
    const lists = tradesStore.loadTrades.mock.calls.length;
    const stats = tradesStore.loadStats.mock.calls.length;
    accountStore.accounts.set([{ status: 'FAILED' }, { status: 'FAILED' }]);
    fixture.detectChanges();
    expect(tradesStore.loadTrades.mock.calls.length).toBe(lists + 1);
    expect(tradesStore.loadStats.mock.calls.length).toBe(stats + 1);
  });

  it('interrupteur éteint (cas du 6/11) : 3 trades, en-tête du jour « 3 trades » -88,50, semaine identique, aucun badge', async () => {
    const { fixture, el } = await render(ACTIVE_TRADES);
    expect(el.querySelectorAll('[data-testid="trade-row"]').length).toBe(3);
    expect(el.querySelectorAll('[data-testid="trade-account-badge"]').length).toBe(0);
    expect(el.querySelector('[data-testid="day-count"]')!.textContent!.trim()).toBe('3 trades');
    const c = fixture.componentInstance as unknown as Groups;
    expect(c.tradesByDay()).toHaveLength(1);
    expect(c.tradesByDay()[0].totalPnlNet).toBeCloseTo(-88.5, 2);
    expect(c.tradesByDay()[0].partial).toBe(false);
    // Semaine = le même jeu (barre de chiffres côté API : même filtre, vérifié par l'int-spec).
    expect(c.tradesByWeek()[0].count).toBe(3);
    expect(c.tradesByWeek()[0].totalPnlNet).toBeCloseTo(-88.5, 2);
    expect(el.querySelector('[data-testid="week-count"]')!.textContent!.trim()).toBe('3 trades');
  });

  it('interrupteur allumé : tous les trades avec le badge « Archivé » ; 6/11 « 5 trades » −621,06, semaine +15 537,80', async () => {
    const { fixture, el } = await render([...ACTIVE_TRADES, ...ARCHIVED_TRADES]);
    expect(el.querySelectorAll('[data-testid="trade-row"]').length).toBe(6);
    const badges = [...el.querySelectorAll('[data-testid="trade-account-badge"]')].map((b) => b.textContent!.trim());
    expect(badges).toEqual(['Archivé', 'Archivé', 'Archivé']);
    expect(el.querySelector('[data-testid="day-count"]')!.textContent!.trim()).toBe('5 trades');
    const c = fixture.componentInstance as unknown as Groups;
    expect(c.tradesByDay().map((d) => d.count)).toEqual([5, 1]);
    expect(c.tradesByDay()[0].totalPnlNet).toBeCloseTo(-621.06, 2);
    expect(c.tradesByWeek()[0].count).toBe(6);
    expect(c.tradesByWeek()[0].totalPnlNet).toBeCloseTo(15_537.8, 2);
    expect(c.tradesByWeek()[0].partial).toBe(false);
  });

  it('compteur des filtres : le nombre de trades des chiffres, sans « dans les chiffres » (liste = chiffres)', async () => {
    const { fixture, el, tradesStore } = await render(ACTIVE_TRADES);
    (tradesStore.stats as unknown as { set: (v: unknown) => void }).set({ totalTrades: 3, winRate: 33, totalPnl: -88.5, excludedAccounts: { failed: 0, archived: 3 } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="journal-filter-count"]')!.textContent!.trim()).toBe('3 trades');
  });
});
