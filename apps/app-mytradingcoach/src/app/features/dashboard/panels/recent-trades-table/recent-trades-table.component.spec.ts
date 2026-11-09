import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MoneyService } from '@app/core/services/money.service';
import type { DashboardTradeRow } from '../../dashboard-charts.util';
import { RecentTradesTableComponent } from './recent-trades-table.component';

/** Historique du dashboard : un trade ouvert garde son badge « OUVERT » neutre à toutes les tailles. */

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

describe('RecentTradesTableComponent · badge OUVERT', () => {
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

  it('tableau : trade ouvert badgé à côté de l\'actif (taille moyenne) en plus de la colonne Résultat', () => {
    const tr = render([row('a', 'open', null), row('w', 'win', 12.5)]).querySelectorAll('.mtc-table tbody tr');
    expect(tr[0].querySelector('.mtc-res-inline.open')?.textContent?.trim()).toBe('OUVERT');
    expect(tr[0].querySelector('.col-res .mtc-res')?.textContent?.trim()).toBe('OUVERT');
    expect(tr[1].querySelector('.mtc-res-inline')).toBeNull();
  });

  it('trade clôturé : pas de badge dans la carte (le P&L coloré suffit)', () => {
    const cards = render([row('w', 'win', 12.5), row('l', 'loss', -4)]).querySelectorAll('.mtc-tc');
    cards.forEach((c) => expect(c.querySelector('.mtc-res')).toBeNull());
  });
});

describe('RecentTradesTableComponent · compte échoué ou archivé', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MoneyService, useValue: { format: (v: number) => `$${v}`, formatFor: (_: string, v: number) => `$${v}` } }],
    });
    TestBed.overrideComponent(RecentTradesTableComponent, {
      set: { styleUrls: [], styleUrl: undefined as unknown as string },
    });
  });

  const withAccount = (id: string, status: string) =>
    ({ ...row(id, 'loss', -300), account: { id: 'acc-' + id, label: 'Compte ' + id, status } }) as unknown as DashboardTradeRow;

  it('badge « Archivé » / « Échoué » dans le tableau et la carte, aucun sur un compte actif', () => {
    const el = render([withAccount('x', 'ARCHIVED'), withAccount('f', 'FAILED'), withAccount('a', 'ACTIVE'), row('n', 'win', 5)]);
    const inTable = [...el.querySelectorAll('.mtc-table [data-testid="trade-account-badge"]')].map((b) => b.textContent!.trim());
    const inCards = [...el.querySelectorAll('.mtc-trade-cards [data-testid="trade-account-badge"]')].map((b) => b.textContent!.trim());
    expect(inTable).toEqual(['Archivé', 'Échoué']);
    expect(inCards).toEqual(['Archivé', 'Échoué']);
    expect(el.querySelector('[data-testid="trade-account-badge"]')!.getAttribute('title')).toBe('Compte x : hors statistiques');
  });
});
