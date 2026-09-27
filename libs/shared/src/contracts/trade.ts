import type { EmotionState, ExecutionGrade, ExecutionMethod, TradeSide, TradingSession } from './enums';

/** Setup tel que renvoyé par l'API sur un trade (relation). */
export interface TradeSetup {
  id: string;
  title: string;
  color: string;
}

/** Trade tel que renvoyé par l'API (GET /trades, GET /trades/:id). Dates en ISO. */
export interface Trade {
  id: string;
  userId: string;
  asset: string;
  side: TradeSide;
  entry: number;
  exit: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  commission: number | null;
  riskReward: number | null;
  quantity: number | null;
  capitalEngaged: number | null;
  /** Émotion saisie sur le trade. null = non renseignée (hérite de l'humeur de session). */
  emotion: EmotionState | null;
  /** Émotion EFFECTIVE calculée par l'API (saisie, sinon humeur de session) : celle à afficher. */
  effectiveEmotion?: string | null;
  /** Note d'exécution calculée par l'API, jamais saisie. null = « Non évalué ». */
  executionScore?: number | null;
  executionGrade?: ExecutionGrade | null;
  /** Barème ayant produit la note : avec stop (STOP_BASED) ou comportemental (BEHAVIORAL). */
  executionMethod?: ExecutionMethod | null;
  setupId: string;
  setup: TradeSetup;
  /** Compte du trade : sa devise est celle de ce compte. */
  accountId?: string | null;
  session: TradingSession;
  timeframe: string;
  notes: string | null;
  tags: string[];
  tradedAt: string;
  createdAt: string;
}

/** Corps de POST /trades. Implémenté côté API par `CreateTradeDto` (class-validator). */
export interface CreateTradeRequest {
  asset: string;
  side: TradeSide;
  entry?: number;
  exit?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl?: number;
  commission?: number;
  riskReward?: number;
  quantity?: number;
  capitalEngaged?: number;
  /** Absente ou null : le trade hérite de l'humeur de session. */
  emotion?: EmotionState | null;
  setupId: string;
  session: TradingSession;
  timeframe: string;
  notes?: string;
  tags?: string[];
  tradedAt?: string;
  accountId?: string;
}

/** Corps de PATCH /trades/:id. */
export type UpdateTradeRequest = Partial<CreateTradeRequest>;

/** Filtres de GET /trades (query string). Implémenté côté API par `TradeFiltersDto`. */
export interface TradeFilters {
  cursor?: string;
  limit?: number | string;
  side?: TradeSide;
  setupId?: string;
  emotion?: string;
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN';
  executionGrade?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
}

/** Page de GET /trades (pagination par curseur). */
export interface TradesPage {
  data: Trade[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

/** KPIs du journal agrégés sur tout l'ensemble filtré (hors pagination). */
export interface JournalStats {
  totalTrades: number;
  winRate: number;
  pnlBrut: number;
  fees: number;
  pnlNet: number;
  bestTrade: number;
  worstTrade: number;
}
