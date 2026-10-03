import { formatMoney } from '@mtc/shared';
import type { AccountProgress, ProgressRequirement } from '../../core/api/accounts.api';

const money = (v: number, currency: string) => formatMoney(v, currency, { decimals: 0, sign: false });
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Titre du bloc : ce qui reste à faire, ou que c'est fait. */
export function progressTitle(p: AccountProgress, currency: string): string {
  if (p.kind === 'objective') {
    return p.done ? 'Objectif atteint' : p.remaining > 0 ? `Objectif : il te reste ${money(p.remaining, currency)}` : 'Objectif : profit atteint, conditions restantes';
  }
  return p.done ? 'Payout possible' : p.remaining > 0 ? `Prochain payout : il te manque ${money(p.remaining, currency)}` : 'Prochain payout : conditions restantes';
}

/** Une exigence en clair : « Jours ≥ $150 : 3 / 5 ». */
export function requirementLabel(r: ProgressRequirement, currency: string): string {
  switch (r.key) {
    case 'profit':
      return `Profit ${money(r.current, currency)} / ${money(r.required, currency)}`;
    case 'trading_days':
      return `Jours tradés ${r.current} / ${r.required}`;
    case 'consistency':
      return `Meilleur jour ${pct(r.current)} du profit (max ${pct(r.required)})`;
    case 'winning_days':
      return `${r.threshold != null ? `Jours ≥ ${money(r.threshold, currency)}` : 'Jours gagnants'} : ${r.current} / ${r.required}`;
    case 'cycle_profit':
      return `Profit du cycle ${money(r.current, currency)} / ${money(r.required, currency)}`;
    case 'safety_net':
      return `Solde ${money(r.current, currency)} / ${money(r.required, currency)} (seuil de retrait)`;
  }
}
