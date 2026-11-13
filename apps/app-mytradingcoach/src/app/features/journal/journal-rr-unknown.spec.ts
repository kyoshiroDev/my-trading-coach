/**
 * Journal — R/R inconnu (trade synchronisé dont la synchronisation n'a pas pu relier le stop ou l'objectif).
 *
 * La ligne affichait « 0 » avec l'info-bulle « Pourquoi le R:R vaut 0 » alors que la valeur est
 * null : un 0 se lit comme un R/R mesuré nul. Elle affiche « — », une info-bulle honnête, et un
 * bouton pour saisir le stop initial. Vrai template, comme `journal-row-net.spec.ts`.
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
import { statsScopeStub } from '../../core/stores/selected-account.store.stub';

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

async function render(trades: Trade[]) {
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
          ...statsScopeStub(),
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
  return fixture;
}


const rrCell = (el: HTMLElement) => el.querySelector('.td-rr') as HTMLElement;
/** Texte de l'info-bulle : lié par `[text]`, donc propriété de l'élément (schéma sans composant). */
const tipText = (cell: HTMLElement) => (cell.querySelector('mtc-info-tooltip') as unknown as { text?: string } | null)?.text;
const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Journal — R/R inconnu', () => {
  it('R/R null : « — », jamais « 0 », info-bulle honnête', async () => {
    const el = (await render([trade({ riskReward: null })])).nativeElement as HTMLElement;
    const cell = rrCell(el);
    expect(text(cell)).toBe('—');
    expect(text(cell)).not.toContain('0');
    const tip = cell.querySelector('mtc-info-tooltip');
    expect(tip?.getAttribute('label')).toBe('Pourquoi le R/R est inconnu');
    expect(tipText(cell)).toBe('Stop loss ou take profit non renseigné. Ajoute ton stop initial pour calculer le R/R.');
  });

  it('R/R absent du payload (undefined) : même rendu « — »', async () => {
    const t = trade({});
    delete (t as Partial<Trade>).riskReward;
    const el = (await render([t])).nativeElement as HTMLElement;
    expect(text(rrCell(el))).toBe('—');
  });

  it('R/R connu : la valeur, sans tiret ni bouton de saisie', async () => {
    const el = (await render([trade({ riskReward: 2.5, stopLoss: 18590, takeProfit: 18625 })])).nativeElement as HTMLElement;
    expect(text(rrCell(el))).toBe('2.50');
    expect(el.querySelector('[data-testid="trade-add-stop"]')).toBeNull();
  });

  it('R/R inconnu : le bouton « Ajouter le stop initial » ouvre la saisie pour CE trade', async () => {
    const fixture = await render([trade({ id: 'sync-1', riskReward: null })]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mtc-trade-stop-dialog')).toBeNull();
    const btn = el.querySelector('[data-testid="trade-add-stop"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Ajouter le stop initial');
    expect(btn.getAttribute('title')).toBe('Ajouter le stop initial');
    btn.click();
    fixture.detectChanges();
    expect(el.querySelector('mtc-trade-stop-dialog')).not.toBeNull();
    expect((fixture.componentInstance as unknown as { stopTrade: () => Trade | null }).stopTrade()?.id).toBe('sync-1');
  });

  it('stop capturé sans objectif : « — », info-bulle « Objectif non renseigné » et bouton « Ajouter l’objectif »', async () => {
    const el = (await render([trade({ riskReward: null, stopLoss: 18590, takeProfit: null })])).nativeElement as HTMLElement;
    const cell = rrCell(el);
    expect(text(cell)).toBe('—');
    expect(tipText(cell)).toBe('Objectif non renseigné. Ajoute ton objectif pour calculer le R/R.');
    const btn = el.querySelector('[data-testid="trade-add-stop"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe("Ajouter l'objectif");
    expect(btn.getAttribute('title')).toBe("Ajouter l'objectif");
  });
});
