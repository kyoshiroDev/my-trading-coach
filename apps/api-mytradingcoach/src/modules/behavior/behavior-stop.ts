import { E1_MIN_TICKS } from './behavior.constants';
import type { BehaviorAlertDraft } from './behavior-detectors';

/**
 * E1 « stop éloigné » (#672) : fonctions PURES, aucune I/O, aucun appel IA.
 *
 * Le latent d'une position n'est pas connu quand son stop bouge (le WebSocket ne pousse ni prix de
 * marché ni P&L latent, lecture seule). Le détecteur regarde donc le RISQUE : un stop de sortie qui
 * s'éloigne de l'entrée en finissant du côté perte augmente la perte maximale du trade, quel que
 * soit le prix (arbitrage du relecteur, `docs/audit-672.md`). Rapprocher le stop, ou le déplacer en
 * restant du côté gain, ne déclenche rien.
 */

export interface StopMove {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  prevStop: number;
  nextStop: number;
  tickSize: number;
}

export interface StopWidening {
  /** Écart entre l'ancien et le nouveau stop, en ticks. */
  widenedTicks: number;
  /** Distance du nouveau stop à l'entrée, en ticks (risque maximal par contrat). */
  riskTicks: number;
}

/** Ticks arrondis à l'unité (un prix de stop tombe sur la grille du contrat, aux erreurs de flottant près). */
const ticks = (points: number, tickSize: number) => Math.round(points / tickSize);

/**
 * Éloignement d'un stop de sortie : le nouveau stop est plus loin de l'entrée côté perte que
 * l'ancien (LONG : abaissé sous l'entrée ; SHORT : remonté au-dessus), d'au moins `E1_MIN_TICKS`.
 * Un ancien stop côté gain qui repasse côté perte compte : le risque augmente aussi.
 */
export function stopWidening(m: StopMove): StopWidening | null {
  if (!(m.tickSize > 0) || ![m.entryPrice, m.prevStop, m.nextStop].every(Number.isFinite)) return null;
  const dir = m.side === 'LONG' ? 1 : -1;
  // Distance côté perte (> 0 = le stop est du côté perte de l'entrée).
  const lossSide = (stop: number) => (m.entryPrice - stop) * dir;
  const next = lossSide(m.nextStop);
  if (next <= 0) return null; // nouveau stop du côté gain (ou à l'entrée) : aucune perte possible en plus
  const widenedTicks = ticks(next - lossSide(m.prevStop), m.tickSize);
  if (widenedTicks < E1_MIN_TICKS) return null;
  return { widenedTicks, riskTicks: ticks(next, m.tickSize) };
}

/** Message FACTUEL (décrire, jamais conseiller, AMF), sans tiret cadratin. */
export function stopWidenedDraft(asset: string, w: StopWidening, context: Record<string, unknown>): BehaviorAlertDraft {
  return {
    type: 'E1_STOP_WIDENED',
    // Un seul niveau pendant la phase silencieuse : les seuils de gravité se fixeront avec les vraies données (#671).
    severity: 'medium',
    message: `Stop éloigné de ${w.widenedTicks} ticks sur ${asset} (risque porté à ${w.riskTicks} ticks).`,
    context: { ...context, widenedTicks: w.widenedTicks, riskTicks: w.riskTicks },
  };
}
