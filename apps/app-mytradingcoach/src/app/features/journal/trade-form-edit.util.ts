import { roundCents } from '@mtc/shared';

/**
 * Formulaire de trade en ÉDITION (#947). Le levier n'est pas stocké : sans le retrouver, il
 * repartait à 1 et la moindre retouche divisait le P&L d'un trade à levier par ce levier.
 */
type EditedTrade = {
  side: string;
  entry: number;
  exit?: number | null;
  pnl?: number | null;
  capitalEngaged?: number | null;
};

/** Variation du prix dans le sens du trade (0,02 = +2 %), ou null si incalculable. */
function variation(t: EditedTrade): number | null {
  if (!(t.entry > 0) || t.exit == null || !(t.exit > 0)) return null;
  return t.side === 'LONG' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry;
}

/**
 * Levier d'un trade crypto saisi avec un capital engagé : P&L = variation × capital × levier.
 * 1 sans capital, sans P&L, sans variation, ou si le résultat n'est pas un levier (< 1, signe opposé).
 */
export function editLeverage(t: EditedTrade): number {
  const v = variation(t);
  const capital = t.capitalEngaged ?? 0;
  if (v == null || v === 0 || !(capital > 0) || t.pnl == null) return 1;
  const lev = roundCents(t.pnl / (v * capital));
  return Number.isFinite(lev) && lev >= 1 ? lev : 1;
}

/** % affiché à l'ouverture : rendement sur le capital engagé (variation × levier), comme à la saisie. */
export function editPnlPct(t: EditedTrade, leverage: number): number | undefined {
  const v = variation(t);
  if (v == null || !((t.capitalEngaged ?? 0) > 0)) return undefined;
  return roundCents(v * leverage * 100);
}
