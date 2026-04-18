import { Pipe, PipeTransform } from '@angular/core';

const SETUP_COLORS_MAP: Record<string, string> = {
    BREAKOUT: '#10b981',
    PULLBACK: '#3b82f6',
    RANGE: '#f59e0b',
    REVERSAL: '#ef4444',
    SCALPING: '#8b5cf6',
    NEWS: '#60a5fa',
};

@Pipe({ name: 'setupColorMap', standalone: true })

export class SetupColorsMapPipe implements PipeTransform {
    transform(colorMap: string): string {
        return SETUP_COLORS_MAP[colorMap] ?? '#6b7280'
    }
}