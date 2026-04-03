import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'pnlColor', standalone: true })
export class PnlColorPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null) return '#6b7280';
    if (value > 0) return '#10b981';
    if (value < 0) return '#ef4444';
    return '#6b7280';
  }
}
