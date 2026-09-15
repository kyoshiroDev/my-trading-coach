import { Pipe, PipeTransform, inject } from '@angular/core';
import { MoneyService } from '../../core/services/money.service';

/**
 * Montant signé dans la devise NATIVE du compte, sans conversion ; `%` optionnel.
 * `{{ total | pnlFormat }}` → devise de l'écran ; `{{ t.pnl | pnlFormat : t.entry : t.accountId }}`
 * → devise du compte du trade (lignes de trades, cf. PROMPT-214).
 */
@Pipe({ name: 'pnlFormat', pure: false })
export class PnlFormatPipe implements PipeTransform {
  private readonly money = inject(MoneyService);

  transform(value: number | null | undefined, entry?: number | null, accountId?: string | null): string {
    if (value == null) return '-';

    let result = accountId ? this.money.formatFor(accountId, value) : this.money.format(value);

    if (entry != null && entry > 0) {
      const pct = (value / entry) * 100;
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
