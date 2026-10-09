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

/** Position ouverte chez le broker (synchro Tradovate), avant qu'elle ne devienne un trade. */
export interface LiveOpenPosition {
  asset: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number | null;
  /** Ouverture de la position (ISO), `null` si le broker ne la donne pas. */
  since: string | null;
}

/**
 * État broker du compte de la session active, dans GET /session/today/stats (`broker`) :
 * `null` si le compte n'est pas synchronisé par API. Le latent vient du broker (ses cotations),
 * relu à chaque événement de trade ou sur « Actualiser », jamais en boucle : d'où sa date.
 */
export interface LiveBrokerState {
  openPositions: LiveOpenPosition[];
  /** Lecture des positions chez le broker (ISO), `null` si jamais lues. */
  positionsAt: string | null;
  /** P&L latent selon le broker ; `null` = inconnu (jamais un chiffre inventé). */
  openPnl: number | null;
  openPnlAt: string | null;
}
