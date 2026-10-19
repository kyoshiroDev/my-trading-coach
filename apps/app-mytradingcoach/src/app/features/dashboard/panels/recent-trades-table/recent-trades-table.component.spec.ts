import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MoneyService } from '@app/core/services/money.service';
import type { DashboardTradeRow } from '../../dashboard-charts.util';
import { RecentTradesTableComponent } from './recent-trades-table.component';

/** Historique du dashboard : un trade ouvert garde son badge « OUVERT » neutre dans les cartes mobiles. */

const row = (id: string, outcome: DashboardTradeRow['outcome'], pnl: number | null): DashboardTradeRow =>
  ({
    id, asset: 'mnq', side: 'SHORT', tradedAt: '2026-10-19T14:00:00Z', entry: 19863.75, exit: null,
    riskReward: 2, pnl, accountId: null, setup: { title: 'Pullback', color: '#3b82f6' },
    outcome, pct: pnl === null ? null : 0.1,
  }) as unknown as DashboardTradeRow;

function render(rows: DashboardTradeRow[]): HTMLElement {
  const fixture = TestBed.createComponent(RecentTradesTableComponent);
  // En JIT (vitest), une entrée signal n'est pas affectable par setInput : on remplace le signal.
  (fixture.componentInstance as unknown as Record<string, unknown>)['rows'] = signal(rows);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('RecentTradesTableComponent · cartes mobiles', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MoneyService, useValue: { format: (v: number) => `$${v}`, formatFor: (_: string, v: number) => `$${v}` } }],
    });
    // Le CSS externe n'est pas compilé par Vitest : seul le template compte ici.
    TestBed.overrideComponent(RecentTradesTableComponent, {
      set: { styleUrls: [], styleUrl: undefined as unknown as string },
    });
  });

  it('trade ouvert : badge OUVERT neutre, P&L et P&L % « - »', () => {
    const card = render([row('a', 'open', null)]).querySelector('.mtc-tc')!;
    const badge = card.querySelector('.mtc-tc-asset .mtc-res');
    expect(badge?.textContent?.trim()).toBe('OUVERT');
    expect(badge?.classList.contains('open')).toBe(true);
    expect(card.querySelector('.mtc-tc-pnl')?.textContent?.trim()).toBe('-');
    expect(card.querySelector('.mtc-tc-pct')?.textContent?.trim()).toBe('-');
  });

  it('trade clôturé : pas de badge dans la carte (le P&L coloré suffit)', () => {
    const cards = render([row('w', 'win', 12.5), row('l', 'loss', -4)]).querySelectorAll('.mtc-tc');
    cards.forEach((c) => expect(c.querySelector('.mtc-res')).toBeNull());
  });
});
