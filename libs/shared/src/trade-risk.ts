import { roundCents } from './trade-stats';

/**
 * Risque d'un trade à partir de son stop initial (et de son objectif) — fonctions PURES, partagées
 * par l'API (enregistrement) et l'app (aperçu en direct dans la saisie rapide du Journal).
 *
 * Un R/R inconnu reste `undefined` / `null`, jamais 0 : un « 0 » se lit comme un R/R mesuré nul.
 */

export type RiskSide = 'LONG' | 'SHORT';

/**
 * R/R PRÉVU : (objectif − entrée) / |entrée − stop|, sens inversé pour un SHORT. Calculé depuis
 * l'objectif (takeProfit), pas depuis la sortie réelle. `undefined` sans stop ou sans objectif, ou
 * si le risque ou le gain prévu est nul ou négatif. Arrondi au centième.
 */
export function plannedRiskReward(
  side: RiskSide,
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): number | undefined {
  if (entry == null || stopLoss == null || takeProfit == null) return undefined;
  const reward = side === 'LONG' ? takeProfit - entry : entry - takeProfit;
  const risk = Math.abs(entry - stopLoss);
  return risk > 0 && reward > 0 ? roundCents(reward / risk) : undefined;
}

/**
 * Le stop (et l'objectif s'il est donné) sont-ils du bon côté du prix d'entrée ? Renvoie le message
 * à afficher, ou `null` si tout est cohérent. LONG : stop sous l'entrée, objectif au-dessus.
 * SHORT : l'inverse. Un stop égal à l'entrée est refusé (risque nul, R/R incalculable).
 */
export function stopPlacementError(
  side: RiskSide,
  entry: number,
  stopLoss: number,
  takeProfit?: number | null,
): string | null {
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return 'Le stop doit être un prix positif.';
  if (side === 'LONG' && stopLoss >= entry) {
    return `Sur un achat (LONG), le stop doit être sous le prix d'entrée (${entry}).`;
  }
  if (side === 'SHORT' && stopLoss <= entry) {
    return `Sur une vente (SHORT), le stop doit être au-dessus du prix d'entrée (${entry}).`;
  }
  if (takeProfit != null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) return "L'objectif doit être un prix positif.";
    if (side === 'LONG' && takeProfit <= entry) {
      return `Sur un achat (LONG), l'objectif doit être au-dessus du prix d'entrée (${entry}).`;
    }
    if (side === 'SHORT' && takeProfit >= entry) {
      return `Sur une vente (SHORT), l'objectif doit être sous le prix d'entrée (${entry}).`;
    }
  }
  return null;
}

/**
 * Risque en devise du compte entre l'entrée et le stop : ticks × valeur du tick × quantité, avec la
 * table des instruments (tickValue / tickSize). `null` si l'instrument n'a pas de valeur du tick
 * connue : on ne devine pas une valeur du point.
 */
export function stopRiskAmount(
  entry: number,
  stopLoss: number,
  quantity: number | null | undefined,
  tickSize: number | null | undefined,
  tickValue: number | null | undefined,
): number | null {
  if (tickValue == null) return null;
  const points = Math.abs(entry - stopLoss);
  const ticks = tickSize && tickSize > 0 ? points / tickSize : points;
  return +(ticks * tickValue * (quantity ?? 1)).toFixed(2);
}

/** Moyenne des R/R CONNUS (null et non finis ignorés). `null` si aucun n'est connu, jamais 0. */
export function averageKnownRiskReward(trades: ReadonlyArray<{ riskReward?: number | null }>): number | null {
  const known = trades.map((t) => t.riskReward).filter((v): v is number => v != null && Number.isFinite(v));
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}
