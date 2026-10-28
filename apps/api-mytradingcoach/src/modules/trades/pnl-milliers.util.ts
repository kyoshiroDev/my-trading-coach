import { roundCents } from '@mtc/shared';
import { INSTRUMENTS } from './instruments.const';

/**
 * Détection des trades importés avec un P&L tronqué au séparateur de milliers (bug prod du
 * 2026-10-28) : `parseFloat("1,125.00")` vaut 1. Fonctions PURES, partagées par le script de
 * réparation (`scripts/repair-tradovate-pnl-milliers.ts`) et la requête de détection.
 *
 * Seuls les futures du référentiel sont vérifiables : leur P&L brut se recalcule exactement à
 * partir des prix (écart × quantité × valeur du point), et ce recalcul ne dépend pas du sens
 * enregistré (un sens inversé échange aussi entrée et sortie, l'écart signé ne change pas).
 */

/** Valeur d'un point par actif futures (tickValue / tickSize), d'après `INSTRUMENTS`. */
export const VALEUR_DU_POINT: ReadonlyMap<string, number> = new Map(
  INSTRUMENTS.filter((i) => i.category === 'FUTURES_US' && i.tickValue && i.tickSize).map((i) => [
    i.symbol,
    (i.tickValue as number) / (i.tickSize as number),
  ]),
);

export interface TradePrix {
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  quantity: number | null;
}

/** P&L brut recalculé depuis les prix, au centime ; null si l'actif n'est pas vérifiable. */
export function brutDepuisPrix(t: TradePrix): number | null {
  const vpp = VALEUR_DU_POINT.get(t.asset);
  if (vpp == null || t.exit == null) return null;
  const ecart = t.side === 'LONG' ? t.exit - t.entry : t.entry - t.exit;
  return roundCents(ecart * (t.quantity && t.quantity > 0 ? t.quantity : 1) * vpp);
}

/**
 * Ce que l'ancien parseur gardait d'un montant ≥ 1 000 : la partie avant la PREMIÈRE virgule.
 * 1 125 → 1 · 12 345,67 → 12 · −1 234 567,89 → −1. Montant < 1 000 : inchangé (non touché).
 */
export function pnlTronque(brut: number): number {
  const abs = Math.abs(brut);
  if (abs < 1000) return brut;
  let tete = Math.floor(abs);
  while (tete >= 1000) tete = Math.floor(tete / 1000);
  return brut < 0 ? -tete : tete;
}

/**
 * Trade touché : P&L brut recalculé ≥ 1 000 $ en valeur absolue ET P&L enregistré égal EXACTEMENT
 * à sa troncature. La signature exacte écarte les écarts d'une autre origine (trade modifié à la
 * main, valeur du point différente chez le broker) : ceux-là ne sont jamais réparés en aveugle.
 */
export function estTronque(t: TradePrix & { pnl: number | null }): boolean {
  const brut = brutDepuisPrix(t);
  return brut != null && t.pnl != null && Math.abs(brut) >= 1000 && t.pnl === pnlTronque(brut);
}
