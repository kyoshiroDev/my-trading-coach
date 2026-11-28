import { computeTradeStats, nearHighImpactNews } from '@mtc/shared';
import type { NewsEvent } from '../behavior/behavior-news';

/**
 * Stat du débrief « Tes trades autour des annonces » (#670), PAR COMPTE : trades de la semaine dont
 * l'heure (`tradedAt`, la clôture pour un trade synchronisé) tombe entre X min avant et X min après
 * une annonce à fort impact de leurs devises, comparés au reste du compte. Par compte pour que chaque
 * montant reste dans la devise de son compte (#947). Fonction PURE, aucune IA.
 */
export interface NewsWindowBucket {
  count: number;
  /** Σ P&L net (frais déduits), dans la devise du compte. */
  pnl: number;
  /** Taux de réussite en pourcentage (0-100), hors trades à l'équilibre. */
  winRate: number;
}

export interface NewsWindowAccount {
  /** Compte du trade ; null = trade sans compte. */
  accountId: string | null;
  inside: NewsWindowBucket;
  outside: NewsWindowBucket;
}

export interface NewsWindowStats {
  windowMinutes: number;
  accounts: NewsWindowAccount[];
}

type WindowTrade = { asset: string; tradedAt: Date; pnl: number | null; commission?: number | null; accountId?: string | null };

const bucket = (trades: WindowTrade[]): NewsWindowBucket => {
  const s = computeTradeStats(trades);
  return { count: s.closed, pnl: s.totalPnl, winRate: Math.round(s.winRate) };
};

/** Null s'il n'y a aucun trade clôturé dans la semaine. Comptes dans l'ordre de leur premier trade. */
export function newsWindowStats(trades: WindowTrade[], events: NewsEvent[], minutes: number): NewsWindowStats | null {
  const closed = trades.filter((t) => t.pnl != null);
  if (!closed.length) return null;
  const byAccount = new Map<string | null, { inside: WindowTrade[]; outside: WindowTrade[] }>();
  for (const t of closed) {
    const near = nearHighImpactNews(t.tradedAt, t.asset, events, minutes);
    const key = t.accountId ?? null;
    const b = byAccount.get(key) ?? { inside: [], outside: [] };
    (near ? b.inside : b.outside).push(t);
    byAccount.set(key, b);
  }
  return {
    windowMinutes: minutes,
    accounts: [...byAccount].map(([accountId, b]) => ({ accountId, inside: bucket(b.inside), outside: bucket(b.outside) })),
  };
}
