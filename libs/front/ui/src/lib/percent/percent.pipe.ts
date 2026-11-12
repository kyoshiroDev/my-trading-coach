import { Pipe, PipeTransform } from '@angular/core';
import { formatPercent } from '@mtc/shared';

/**
 * `{{ winRate | pct }}` → « 63% » ; inconnu → « — » ; 0 → « 0% ». Même format partout (app et
 * admin), par `formatPercent` de `@mtc/shared` (#947). Nommé `pct` : `percent` est le pipe Angular
 * (ratio 0..1, séparateurs de la locale).
 */
@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 0, sign = false): string {
    return formatPercent(value, { decimals, sign });
  }
}
