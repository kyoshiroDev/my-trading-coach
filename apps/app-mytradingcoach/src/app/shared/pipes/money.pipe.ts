import { Pipe, PipeTransform, inject } from '@angular/core';
import { UserStore } from '../../core/stores/user.store';

/**
 * Montant USD → devise du user, signe compris : `{{ pnl | money }}` → `+$1,234.56`,
 * `{{ pnl | money:0 }}` → `+$1,235`, `{{ fees | money:2:false }}` → `$12.30` (sans `+`).
 * Même formateur que `pnlFormat` (core/utils/money.ts).
 */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly userStore = inject(UserStore);

  transform(value: number | null | undefined, decimals = 2, sign = true): string {
    if (value == null) return '-';
    return this.userStore.formatMoney(value, { decimals, sign });
  }
}
