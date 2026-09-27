import type { CreateTradeDto } from './dto/create-trade.dto';
import { getTickSize, getTickValue } from './instruments.const';

/**
 * P&L BRUT du trade (résultat des prix). Les frais restent dans `commission` : le net est
 * calculé à la lecture par `netPnl` (@mtc/shared), CONVENTION UNIQUE. Avant,
 * ce calcul retirait déjà les frais alors que les écrans les retiraient encore : frais
 * comptés deux fois sur les trades saisis ou édités.
 */
export function calculatePnl(dto: CreateTradeDto): number | undefined {
  if (dto.entry == null || dto.entry <= 0) return undefined;

  // P&L réalisé fourni (import broker, ou édition sans changement de prix/qty) = source de vérité.
  // On NE recalcule PAS points × quantité : faux pour la crypto/contrats (qty MEXC en contrats, pas en coins).
  if (dto.pnl != null) return +dto.pnl.toFixed(2);

  if (dto.exit == null || dto.exit <= 0) return undefined;
  const effectiveExit = dto.exit;

  const points =
    dto.side === 'LONG'
      ? effectiveExit - dto.entry
      : dto.entry - effectiveExit;

  const quantity = dto.quantity ?? 1;
  const tickValue = getTickValue(dto.asset);
  const tickSize = getTickSize(dto.asset);

  let pnl: number;
  if (tickValue != null) {
    const ticks = tickSize && tickSize > 0 ? points / tickSize : points;
    pnl = ticks * tickValue * quantity;
  } else if (dto.capitalEngaged != null && dto.capitalEngaged > 0) {
    pnl = (points / dto.entry) * dto.capitalEngaged;
  } else {
    pnl = points * quantity;
  }

  return +pnl.toFixed(2);
}

export function calculateRiskReward(dto: CreateTradeDto): number | undefined {
  // R/R calculé depuis takeProfit (objectif prévu), pas exit (sortie réelle)
  if (dto.entry != null && dto.takeProfit != null && dto.stopLoss != null) {
    const reward =
      dto.side === 'LONG'
        ? dto.takeProfit - dto.entry
        : dto.entry - dto.takeProfit;
    const risk = Math.abs(dto.entry - dto.stopLoss);
    return risk > 0 && reward > 0 ? +(reward / risk).toFixed(2) : undefined;
  }
  return undefined;
}
