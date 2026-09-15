import { Pipe, PipeTransform, inject } from '@angular/core';
import { MoneyService } from '../../core/services/money.service';

/** Montant signé dans la devise native du compte affiché, sans conversion ; `%` optionnel. */
@Pipe({ name: 'pnlFormat', pure: false })
export class PnlFormatPipe implements PipeTransform {
  private readonly money = inject(MoneyService);

  transform(value: number | null | undefined, entry?: number | null): string {
    if (value == null) return '-';

    let result = this.money.format(value);

    if (entry != null && entry > 0) {
      const pct = (value / entry) * 100;
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
