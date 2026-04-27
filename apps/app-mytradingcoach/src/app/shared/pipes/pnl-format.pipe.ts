import { Pipe, PipeTransform, inject } from '@angular/core';
import { UserStore } from '../../core/stores/user.store';

@Pipe({ name: 'pnlFormat', standalone: true, pure: false })
export class PnlFormatPipe implements PipeTransform {
  private readonly userStore = inject(UserStore);

  transform(value: number | null | undefined, entry?: number | null): string {
    if (value == null) return '—';

    const currency = this.userStore.user()?.currency ?? 'USD';
    const rate = this.userStore.user()?.currencyRate ?? 1;
    const converted = value * rate;
    const symbol = currency === 'EUR' ? '€' : '$';

    const sign = converted >= 0 ? '+' : '-';
    const formatted = Math.abs(converted).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    let result = `${sign}${symbol}${formatted}`;

    if (entry != null && entry > 0) {
      // Le % reste basé sur la valeur originale (ratio inchangé par la conversion)
      const pct = (value / entry) * 100;
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
