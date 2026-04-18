import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe PnlClass
 *
 * Retourne la classe CSS correspondant au signe d'une valeur P&L.
 *
 * On utilise un pipe plutôt qu'une méthode dans le composant car :
 * - La même logique est nécessaire partout où un P&L est affiché
 * - Évite de répliquer un triple ternaire dans chaque composant
 * - S'utilise directement dans le binding de classe : [class]="value | pnlClass"
 *
 * @example
 * [class]="trade.pnl | pnlClass"   // trade.pnl = 450  → "text-green"
 * [class]="trade.pnl | pnlClass"   // trade.pnl = -120 → "text-red"
 * [class]="trade.pnl | pnlClass"   // trade.pnl = 0    → ""
 */
@Pipe({ name: 'pnlClass', standalone: true })
export class PnlClassPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || value === 0) return '';
    return value > 0 ? 'text-green' : 'text-red';
  }
}
