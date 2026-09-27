import { Pipe, PipeTransform, inject } from '@angular/core';
import { priceMovePct, type PriceMoveInput } from '@mtc/shared';
import { MoneyService } from '../../core/services/money.service';

/**
 * Montant signé dans la devise NATIVE du compte, sans conversion ; `%` optionnel.
 * `{{ total | pnlFormat }}` → devise de l'écran ; `{{ t.pnl | pnlFormat : t : t.accountId }}`
 * → devise du compte du trade (lignes de trades, cf. PROMPT-214), suivie de la variation du
 * prix entre entrée et sortie (`priceMovePct`), jamais d'un ratio P&L / prix.
 */
@Pipe({ name: 'pnlFormat', pure: false })
export class PnlFormatPipe implements PipeTransform {
  private readonly money = inject(MoneyService);

  transform(value: number | null | undefined, move?: PriceMoveInput | null, accountId?: string | null): string {
    if (value == null) return '-';

    let result = accountId ? this.money.formatFor(accountId, value) : this.money.format(value);

    const pct = move ? priceMovePct(move) : null;
    if (pct !== null) {
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
