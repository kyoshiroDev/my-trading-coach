import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DialogDirective } from '@mtc/front-ui';
import { DRAWDOWN_LABELS, formatMoney, formatPercent } from '@mtc/shared';
import type { TradingAccount } from '../../../../../../core/api/accounts.api';
import { SelectedAccountStore } from '../../../../../../core/stores/selected-account.store';
import { countsInAggregate } from '../../../../../../core/utils/account-status.util';
import {
  MULTI_ACCOUNT_VIEW_FOR_ALL_PLANS,
  accountExposure,
  drawdownTone,
  groupByExposure,
} from '../../../../../../core/utils/account-exposure.util';
import { relativeTime } from '../../../../../../core/utils/tradovate-return.util';

/**
 * Bandeau « Mes comptes » de la Session live (#668) : une pastille par compte suivi, du plus exposé au
 * moins exposé (marge la plus serrée en %), à partir de 2 comptes. Un tap ouvre le détail du compte
 * (3 distances, heure du relevé, disclaimer). Vue en lecture : le compte de la séance ne change pas
 * (une séance = un compte, verrouillé pendant la séance, #880). Ouvert à tous les plans (22/11).
 */
@Component({
  selector: 'mtc-live-accounts-strip',
  imports: [DialogDirective],
  templateUrl: './live-accounts-strip.component.html',
  styleUrl: './live-accounts-strip.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveAccountsStripComponent {
  private readonly store = inject(SelectedAccountStore);
  /** Compte de la séance en cours (rappelé dans le détail). */
  readonly sessionAccountId = input<string | null>(null);

  protected readonly ddLabels = DRAWDOWN_LABELS;
  protected readonly openId = signal<string | null>(null);

  protected readonly tracked = computed(() =>
    MULTI_ACCOUNT_VIEW_FOR_ALL_PLANS ? groupByExposure(this.store.accounts().filter((a) => countsInAggregate(a.status))).tracked : [],
  );
  protected readonly visible = computed(() => this.tracked().length >= 2);
  protected readonly opened = computed(() => this.tracked().find((a) => a.id === this.openId()) ?? null);

  protected tone(a: TradingAccount): string {
    return drawdownTone(accountExposure(a));
  }
  protected pct(a: TradingAccount): string {
    const e = accountExposure(a);
    return e ? formatPercent(e.pct * 100) : '—';
  }
  protected marginPct(g: { pct: number }): string {
    return formatPercent(g.pct * 100);
  }
  protected money(a: TradingAccount, v: number): string {
    return formatMoney(v, a.currency, { decimals: 0, sign: false });
  }
  protected toneOf(g: { pct: number; breached: boolean }): string {
    return drawdownTone(g);
  }
  protected objRemaining(a: TradingAccount): number {
    const o = a.metrics.objective;
    return o ? Math.max(0, o.target - o.current) : 0;
  }
  protected age(a: TradingAccount): string | null {
    const b = a.metrics.broker;
    if (!b) return null;
    const at = [b.equityAt, b.balanceAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return relativeTime(at);
  }
  protected label(a: TradingAccount): string {
    const e = accountExposure(a);
    const which = e?.source === 'daily' ? 'perte max du jour' : 'marge avant le plancher';
    return `${a.label} : ${which}, ${this.pct(a)} restants${a.id === this.sessionAccountId() ? ' (compte de la séance)' : ''}`;
  }
}
