import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'pnlColor', standalone: true })
export class PnlColorPipe implements PipeTransform {
  transform(value: number | null | undefined): 'pos' | 'neg' | 'neutral' {
    if (value == null) return 'neutral';
    if (value > 0) return 'pos';
    if (value < 0) return 'neg';
    return 'neutral';
  }
}
