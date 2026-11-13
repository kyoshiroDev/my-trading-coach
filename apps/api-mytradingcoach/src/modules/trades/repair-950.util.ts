/**
 * Réparation #950 (audit des chiffres #947), partie pure : quels trades sont faux en base, et
 * leurs valeurs justes. Utilisé par `scripts/repair-chiffres-950.ts`. Chaque règle reproduit
 * EXACTEMENT le code corrigé, pour qu'un ré-import du même fichier reconnaisse le trade réparé.
 */
import { roundCents } from '@mtc/shared';
import { calculatePnl } from './trade-metrics.util';
import type { CreateTradeDto } from './dto/create-trade.dto';

/** Mise en prod du lot 1 de l'audit (CD de `main` 96983a0c, PR #961) : les imports d'après sont justes. */
export const LOT1_EN_PROD = new Date('2026-11-11T23:53:35Z');

/**
 * Symbole MEXC tel que l'ancien parseur l'a stocké : `BTC/USDT` (normalisé), ou brut quand il est
 * exotique (`NAS100USDT`, `GOLD(XAUT)USDT`, `BTC_USDT`, voir `normalizeMexcSymbol`).
 */
const SYMBOLE_MEXC = /(\/USD|USDT|USDC)$/i;

/** Étiquettes posées par la clôture d'un trade depuis la séance (`SessionService.closeTrade`). */
export const TAGS_CLOTURE = ['SL', 'TP', 'MANUAL'] as const;

/** Vrai si le montant porte des fractions de centime (valeur brute d'un fichier, jamais arrondie). */
export function sousLeCentime(x: number | null | undefined): boolean {
  if (x == null || !Number.isFinite(x)) return false;
  return Math.abs(x * 100 - Math.round(x * 100)) > 1e-6;
}

export type TradeLu = {
  source: string;
  asset: string;
  side: string;
  entry: number;
  exit: number | null;
  pnl: number | null;
  commission: number | null;
  quantity: number | null;
  capitalEngaged: number | null;
  tags: string[];
  createdAt: Date;
};

/** Trade MEXC importé avant le lot 1 et candidat : import CSV, symbole MEXC, frais, avant la mise en prod. */
function candidatMexc(t: TradeLu): boolean {
  return (
    t.source === 'CSV_IMPORT' &&
    SYMBOLE_MEXC.test(t.asset) &&
    t.pnl != null &&
    (t.commission ?? 0) > 0 &&
    t.createdAt < LOT1_EN_PROD
  );
}

/**
 * Trade MEXC stocké au P&L NET (ancien parseur : « Realized PNL » dans `pnl`, frais dans
 * `commission`, le net affiché retirait les frais une 2ᵉ fois). Signature sûre : les frais bruts
 * du fichier (`Math.abs(fee)`, jamais arrondis par l'ancien parseur) ont des fractions de centime.
 * Binance et Bybit n'ont pas de colonne de frais ; la répartition d'un total de frais à l'import
 * arrondit toujours au centime : ni l'un ni l'autre ne passe ce filtre.
 */
export function estMexcAuNet(t: TradeLu): boolean {
  return candidatMexc(t) && sousLeCentime(t.commission);
}

/**
 * Candidat MEXC dont les frais tombent pile au centime mais dont le P&L est une valeur brute de
 * fichier : impossible de le distinguer d'un import Binance/Bybit avec frais répartis. Compté,
 * jamais modifié (à regarder à la main si > 0). Un trade déjà réparé (P&L au centime) n'en est pas.
 */
export function estMexcAmbigu(t: TradeLu): boolean {
  // USDT/USDC seulement : une paire `X/USD` à frais ronds est presque toujours du forex (MT5).
  return candidatMexc(t) && /(USDT|USDC)$/i.test(t.asset) && !sousLeCentime(t.commission) && sousLeCentime(t.pnl);
}

/** Valeurs du parseur corrigé (74f6ad26) : frais au centime, brut = net arrondi + frais. */
export function valeursMexcCorrigees(t: { pnl: number | null; commission: number | null }): { pnl: number; commission: number } {
  const commission = roundCents(Math.abs(t.commission ?? 0));
  return { commission, pnl: roundCents(roundCents(t.pnl ?? 0) + commission) };
}

/** P&L de la clôture corrigée (2635a248) : la règle unique `calculatePnl`, prix → argent. */
export function pnlCloture(t: TradeLu): number | undefined {
  return calculatePnl({
    asset: t.asset,
    side: t.side,
    entry: t.entry,
    exit: t.exit ?? undefined,
    quantity: t.quantity ?? undefined,
    capitalEngaged: t.capitalEngaged ?? undefined,
  } as CreateTradeDto);
}

/**
 * Trade clôturé depuis la séance avant le correctif (créé avant le lot 1, 2635a248 en fait partie) :
 * l'ancien code stockait l'écart de prix
 * (sortie − entrée, signé par le sens) comme P&L. Trois conditions : étiquette de clôture,
 * P&L égal à l'écart de prix, et la règle unique donne un autre montant (sinon rien à corriger :
 * crypto en quantité 1 sans capital, par exemple).
 */
export function estClotureEcartDePrix(t: TradeLu): boolean {
  if (t.exit == null || t.pnl == null || t.createdAt >= LOT1_EN_PROD) return false;
  if (!t.tags.some((tag) => (TAGS_CLOTURE as readonly string[]).includes(tag))) return false;
  const ecart = t.side === 'LONG' ? t.exit - t.entry : t.entry - t.exit;
  if (Math.abs(t.pnl - ecart) >= 0.005) return false;
  const juste = pnlCloture(t);
  return juste != null && Math.abs(juste - t.pnl) >= 0.005;
}

export type TotauxSeance = {
  totalPnl: number | null;
  totalTrades: number;
  winRate: number | null;
  maxDrawdown: number | null;
  bestTradePnl: number | null;
  bestTradeAsset: string | null;
};

/** Totaux stockés d'une séance différents du recalcul (au centime, win rate au centième). */
export function totauxDifferents(stocke: TotauxSeance, juste: TotauxSeance): boolean {
  const num = (a: number | null, b: number | null, tol: number) =>
    a == null || b == null ? a !== b : Math.abs(a - b) >= tol;
  return (
    stocke.totalTrades !== juste.totalTrades ||
    num(stocke.totalPnl, juste.totalPnl, 0.005) ||
    num(stocke.winRate, juste.winRate, 0.005) ||
    num(stocke.maxDrawdown, juste.maxDrawdown, 0.005) ||
    num(stocke.bestTradePnl, juste.bestTradePnl, 0.005) ||
    (stocke.bestTradeAsset ?? null) !== (juste.bestTradeAsset ?? null)
  );
}
