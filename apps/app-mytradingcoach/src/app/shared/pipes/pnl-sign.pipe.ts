import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'pnlSign', standalone: true })
export class PnlSignPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '-';
    return `${sign}$${Math.abs(value).toFixed(2)}`;
  }
}
