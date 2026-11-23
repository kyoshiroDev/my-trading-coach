import { computeTradeStats } from '@mtc/shared';
import { assetCurrencies } from '../eco-calendar/eco-calendar.briefing';
import type { NewsEvent } from '../behavior/behavior-news';

/**
 * Stat du débrief « Tes trades autour des annonces » (#670) : trades de la semaine dont l'heure
 * (`tradedAt`, la clôture pour un trade synchronisé) tombe entre X min avant et X min après une
 * annonce à fort impact de leurs devises, comparés au reste. Fonction PURE, aucune IA.
 */
export interface NewsWindowBucket {
  count: number;
  /** Σ P&L net (frais déduits). */
  pnl: number;
  /** Taux de réussite en pourcentage (0-100), hors trades à l'équilibre. */
  winRate: number;
}

export interface NewsWindowStats {
  windowMinutes: number;
  inside: NewsWindowBucket;
  outside: NewsWindowBucket;
}

type WindowTrade = { asset: string; tradedAt: Date; pnl: number | null; commission?: number | null };

const bucket = (trades: WindowTrade[]): NewsWindowBucket => {
  const s = computeTradeStats(trades);
  return { count: s.closed, pnl: s.totalPnl, winRate: Math.round(s.winRate) };
};

/** Null s'il n'y a aucun trade clôturé dans la semaine. */
export function newsWindowStats(trades: WindowTrade[], events: NewsEvent[], minutes: number): NewsWindowStats | null {
  const closed = trades.filter((t) => t.pnl != null);
  if (!closed.length) return null;
  const span = minutes * 60_000;
  const inside: WindowTrade[] = [];
  const outside: WindowTrade[] = [];
  for (const t of closed) {
    const ccys = assetCurrencies(t.asset);
    const near = events.some((e) => ccys.includes(e.currency) && Math.abs(t.tradedAt.getTime() - e.at.getTime()) <= span);
    (near ? inside : outside).push(t);
  }
  return { windowMinutes: minutes, inside: bucket(inside), outside: bucket(outside) };
}
