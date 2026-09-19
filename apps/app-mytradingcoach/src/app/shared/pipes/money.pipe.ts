import { Pipe, PipeTransform, inject } from '@angular/core';
import { MoneyService } from '../../core/services/money.service';

/**
 * Montant dans la devise native du compte, sans conversion, signe compris :
 * `{{ pnl | money }}` → `+$1,234.56`, `{{ pnl | money:0 }}` → `+$1,235`,
 * `{{ fees | money:2:false }}` → `$12.30` (sans `+`), `{{ pnl | money:0:true:t.accountId }}` →
 * devise du compte du trade. Même formateur que `pnlFormat` (`@mtc/shared`).
 */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly money = inject(MoneyService);

  transform(value: number | null | undefined, decimals = 2, sign = true, accountId?: string | null): string {
    if (value == null) return '-';
    return accountId
      ? this.money.formatFor(accountId, value, { decimals, sign })
      : this.money.format(value, { decimals, sign });
  }
}
