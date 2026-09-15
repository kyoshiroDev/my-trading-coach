import { Pipe, PipeTransform, inject } from '@angular/core';
import { MoneyService } from '../../core/services/money.service';

/**
 * Montant dans la devise native du compte affiché, sans conversion, signe compris :
 * `{{ pnl | money }}` → `+$1,234.56`, `{{ pnl | money:0 }}` → `+$1,235`,
 * `{{ fees | money:2:false }}` → `$12.30` (sans `+`). Même formateur que `pnlFormat`.
 */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly money = inject(MoneyService);

  transform(value: number | null | undefined, decimals = 2, sign = true): string {
    if (value == null) return '-';
    return this.money.format(value, { decimals, sign });
  }
}
