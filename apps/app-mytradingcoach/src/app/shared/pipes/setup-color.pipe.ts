import { Pipe, PipeTransform } from '@angular/core';

const SETUP_COLORS: Record<string, string> = {
  BREAKOUT: '#10b981',
  PULLBACK: '#3b82f6',
  RANGE: '#f59e0b',
  REVERSAL: '#ef4444',
  SCALPING: '#8b5cf6',
  NEWS: '#60a5fa',
};

@Pipe({ name: 'setupColor', standalone: true })
export class SetupColorPipe implements PipeTransform {
  transform(setup: string): string {
    return SETUP_COLORS[setup] ?? '#6b7280';
  }
}
