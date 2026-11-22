import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { TradingAccount } from '../../../../../../core/api/accounts.api';
import { SelectedAccountStore } from '../../../../../../core/stores/selected-account.store';
import { LiveAccountsStripComponent } from './live-accounts-strip.component';
import TEMPLATE from './live-accounts-strip.component.html?raw';

/** Bandeau « Mes comptes » de la Session live (#668) : VRAI template. */

type Gauge = { pct: number; breached?: boolean };
function acct(id: string, dd: Gauge | null, daily: Gauge | null = null, p: Partial<TradingAccount> = {}): TradingAccount {
  return {
    id, label: `Compte ${id}`, status: 'ACTIVE', type: 'EVALUATION', currency: 'USD', propFirmPlanId: 'plan', planLinkChoice: null,
    metrics: {
      drawdown: dd ? { type: 'TRAILING', floor: 48000, margin: Math.round(2000 * dd.pct), maxDrawdown: 2000, pct: dd.pct, breached: !!dd.breached, source: 'plan', rule: null } : null,
      dailyLoss: daily ? { limit: 1000, used: 0, remaining: Math.round(1000 * daily.pct), pct: daily.pct, breached: !!daily.breached, breach: 'trading_paused_for_day', basis: 'equity', startOfDay: 0, source: 'trades', approximate: false } : null,
      drawdownUnconfirmed: false,
      objective: { current: 1000, target: 3000, pct: 1 / 3 },
      broker: null,
    },
    ...p,
  } as unknown as TradingAccount;
}

function setup(accounts: TradingAccount[], sessionAccountId: string | null = null) {
  TestBed.configureTestingModule({ providers: [{ provide: SelectedAccountStore, useValue: { accounts: signal(accounts) } }] });
  TestBed.overrideComponent(LiveAccountsStripComponent, { set: { template: TEMPLATE, styleUrl: undefined as unknown as string, styleUrls: [] } });
  const fixture = TestBed.createComponent(LiveAccountsStripComponent);
  // JIT sous vitest : les `input()` ne se règlent pas par setInput, on remplace leur signal.
  (fixture.componentInstance as unknown as Record<string, unknown>)['sessionAccountId'] = signal(sessionAccountId);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q };
}

describe('Session live · bandeau multi-comptes (#668)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('absent avec un seul compte suivi', () => {
    const { q } = setup([acct('a', { pct: 0.6 }), acct('p', null, null, { type: 'PERSONAL', propFirmPlanId: null })]);
    expect(q('live-accounts-strip')).toBeNull();
  });

  it('pastilles du plus exposé au moins exposé, marge la plus serrée en %, échoués exclus', () => {
    const { el } = setup([
      acct('safe', { pct: 0.9 }),
      acct('hot', { pct: 0.7 }, { pct: 0.12 }),
      acct('mid', { pct: 0.4 }),
      acct('failed', { pct: 0 }, null, { status: 'FAILED' }),
    ]);
    const chips = [...el.querySelectorAll('[data-testid^="live-account-chip-"]')];
    expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual(['live-account-chip-hot', 'live-account-chip-mid', 'live-account-chip-safe']);
    expect(chips[0].textContent).toContain('12\u00a0%');
    expect(chips[0].className).toContain('tone-red');
    expect(chips[0].className).toContain('is-first');
  });

  it('un tap : détail en lecture (3 distances, disclaimer), compte de la séance rappelé', () => {
    const { q, fixture } = setup([acct('a', { pct: 0.9 }), acct('b', { pct: 0.3 }, { pct: 0.5 })], 'b');
    q('live-account-chip-b')!.click();
    fixture.detectChanges();
    expect(q('live-account-sheet-session')!.textContent).toContain('Compte de la séance');
    expect(q('live-account-sheet-daily')!.textContent).toContain('500');
    expect(q('live-account-sheet-drawdown')!.textContent).toContain('600');
    expect(q('live-account-sheet-objective')!.textContent).toContain('pour l’objectif');
    expect(q('live-account-sheet')!.textContent).toContain('Estimation MyTradingCoach, pas le calcul officiel de ta firm.');
    q('live-account-sheet-close')!.click();
    fixture.detectChanges();
    expect(q('live-account-sheet')).toBeNull();
  });
});
