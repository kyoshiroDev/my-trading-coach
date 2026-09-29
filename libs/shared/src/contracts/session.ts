import type { MoodState } from './enums';

/** Session clôturée, telle que renvoyée par GET /session/history. Dates en ISO. */
export interface SessionHistoryItem {
  id: string;
  startedAt: string;
  endedAt?: string;
  moodStart?: MoodState | null;
  moodEnd?: MoodState | null;
  totalPnl?: number | null;
  totalTrades: number;
  winRate?: number | null;
  notes?: string | null;
  reflectionNote?: string | null;
  reflectionQuestion?: string | null;
  planNote?: string | null;
  marketContext?: string | null;
  maxDrawdown?: number | null;
  bestTradePnl?: number | null;
  bestTradeAsset?: string | null;
  topAssets: string[];
  /** Résumé IA du récap quotidien du même jour (heure de Paris), s'il existe. */
  aiOneLiner?: string | null;
}
