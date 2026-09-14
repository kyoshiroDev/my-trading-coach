import { Pipe, PipeTransform, inject } from '@angular/core';
import { UserStore } from '../../core/stores/user.store';

@Pipe({ name: 'pnlFormat', pure: false })
export class PnlFormatPipe implements PipeTransform {
  private readonly userStore = inject(UserStore);

  transform(value: number | null | undefined, entry?: number | null): string {
    if (value == null) return '-';

    let result = this.userStore.formatMoney(value);

    if (entry != null && entry > 0) {
      // Le % reste basé sur la valeur originale (ratio inchangé par la conversion)
      const pct = (value / entry) * 100;
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
