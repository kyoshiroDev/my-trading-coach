import { Pipe, PipeTransform } from '@angular/core';

/**
 * Pipe PnlFormat
 *
 * Formate un P&L en dollars avec signe, et affiche optionnellement le pourcentage.
 *
 * On utilise un pipe plutôt qu'une méthode dans le composant car :
 * - Le pipe est réutilisable dans tous les composants (dashboard, analytics, journal...)
 * - Angular met en cache le résultat (pure pipe) → pas de recalcul inutile à chaque rendu
 * - Le template reste propre : {{ value | pnlFormat:entry }} au lieu d'une méthode
 *
 * @example
 * {{ 5000 | pnlFormat }}              // "+$5,000.00"
 * {{ 5000 | pnlFormat:60000 }}        // "+$5,000.00 (+8.33%)"
 * {{ -340 | pnlFormat:4080 }}         // "-$340.00 (-8.33%)"
 * {{ null | pnlFormat }}              // "—"
 */
@Pipe({ name: 'pnlFormat', standalone: true })
export class PnlFormatPipe implements PipeTransform {
  transform(value: number | null | undefined, entry?: number | null): string {
    if (value == null) return '—';

    const sign = value >= 0 ? '+' : '-';
    const formatted = Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    let result = `${sign}$${formatted}`;

    if (entry != null && entry > 0) {
      const pct = (value / entry) * 100;
      const pctSign = pct >= 0 ? '+' : '';
      result += ` (${pctSign}${pct.toFixed(2)}%)`;
    }

    return result;
  }
}
